import { Activity, ChevronDown, Copy, Plus, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acceptTraceSnapshot } from "./traceState";

type TraceEntry = { sequence: number; kind: string; payload: any };
type TraceRecord = { turnId: string; state: string; operation: string; entries: TraceEntry[] };
type WorkbenchPageId = "trace";
type CompactionTracePayload = {
  state: string;
  trigger: string;
  kind?: string;
  compactThroughSeq?: number;
  retainedFromSeq?: number;
  retainedTokenCount?: number;
  checkpointId?: string;
  coverage?: { fromSeq?: number; toSeq?: number };
  retainedTail?: { fromSeq?: number; toSeq?: number };
  diagnostics?: {
    before?: { tokens?: number; exact?: boolean };
    after?: { tokens?: number; exact?: boolean };
  };
  summaryUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    exact?: boolean;
  };
  reason?: string;
  error?: string;
};

const WORKBENCH_PAGES: Record<WorkbenchPageId, { label: string; icon: typeof Activity }> = {
  trace: { label: "Trace", icon: Activity },
};

function restoredTabs(): WorkbenchPageId[] {
  try {
    const raw = localStorage.getItem("loom:workbench:tabs");
    if (raw !== null) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.every((item): item is WorkbenchPageId => item === "trace")) return [...new Set(saved)];
    }
  } catch { /* fall back to legacy preference */ }
  return localStorage.getItem("loom:workbench:trace") === "1" ? ["trace"] : [];
}

function traceSummary(record: TraceRecord & { startedAt?: number; endedAt?: number }) {
  const request = record.entries.find((entry) => entry.kind === "request")?.payload;
  const response = record.entries.find((entry) => entry.kind === "response")?.payload;
  const model = request?.model?.provider && request?.model?.id ? `${request.model.provider}/${request.model.id}` : "—";
  const duration = typeof record.startedAt === "number" && typeof record.endedAt === "number" ? `${((record.endedAt - record.startedAt) / 1000).toFixed(1)}s` : undefined;
  const usage = usageFacts(response?.message?.usage ?? response?.usage);
  return [model, duration, usageSummary(usage)].filter(Boolean).join(" · ");
}

type UsageFacts = {
  input?: number;
  output?: number;
  total?: number;
  cached?: number;
  reasoning?: number;
};

function numberField(value: any, keys: string[]) {
  for (const key of keys) {
    const field = value?.[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
}

function usageFacts(usage: any): UsageFacts | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return {
    input: numberField(usage, ["inputTokens", "promptTokens", "prompt_tokens", "input_tokens"]),
    output: numberField(usage, ["outputTokens", "completionTokens", "completion_tokens", "output_tokens"]),
    total: numberField(usage, ["totalTokens", "total_tokens"]),
    cached: numberField(usage, ["cachedTokens", "cacheTokens", "cached_tokens", "promptCacheHitTokens", "prompt_cache_hit_tokens"]),
    reasoning: numberField(usage, ["reasoningTokens", "reasoning_tokens"]),
  };
}

function usageSummary(usage: UsageFacts | undefined) {
  if (!usage) return undefined;
  const parts = [
    typeof usage.input === "number" ? `in ${usage.input}` : undefined,
    typeof usage.output === "number" ? `out ${usage.output}` : undefined,
    typeof usage.total === "number" ? `total ${usage.total}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" · ")} tokens` : undefined;
}

function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function traceText(value: unknown, fallback = "—") {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof (value as { text?: unknown }).text === "string") {
    const { text, truncated } = value as { text: string; truncated?: boolean };
    return `${text}${truncated ? "\n[TRUNCATED]" : ""}`;
  }
  if (value == null) return fallback;
  return JSON.stringify(value, null, 2);
}

function textFromContent(content: unknown) {
  if (!Array.isArray(content)) return traceText(content);
  return content.map((part: any) => {
    if (part?.type === "text") return traceText(part.text, "");
    if (part?.type === "image") return `[image: ${part.mimeType ?? "unknown"}]`;
    if (part?.type === "toolCall") return `tool call: ${traceText(part.name, "tool")}\nid: ${traceText(part.id, "—")}\narguments: ${JSON.stringify(part.arguments ?? {}, null, 2)}`;
    return JSON.stringify(part);
  }).join("\n");
}

function textFromTraceMessage(message: any) {
  const preview = traceText(message?.text, "");
  const content = textFromContent(message?.content);
  const body = [preview, content === "—" ? "" : content].filter((line) => typeof line === "string" && line.trim().length > 0);
  if (body.length > 0) return body.join("\n");
  if (Array.isArray(message?.contentParts) && message.contentParts.length > 0) return `[content parts: ${message.contentParts.join(", ")}]`;
  return "—";
}

function toolCallsFromContent(content: unknown) {
  return Array.isArray(content) ? content.filter((part: any) => part?.type === "toolCall") : [];
}

function isCompactionPayload(payload: unknown): payload is CompactionTracePayload {
  if (!payload || typeof payload !== "object") return false;
  const { state, trigger } = payload as { state?: unknown; trigger?: unknown };
  return typeof state === "string"
    && ["planned", "succeeded", "aborted", "failed"].includes(state)
    && typeof trigger === "string"
    && ["manual", "threshold", "overflow"].includes(trigger);
}

function isSkillMessage(message: any) {
  return message?.role === "user" && typeof message?.content === "string" && message.content.startsWith("[Loom skill context]");
}

function CopyButton({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return <button className="trace-copy" aria-label={`复制${label}`} onClick={copy}><Copy size={13} />{copied ? "已复制" : "复制"}</button>;
}

function MessageList({ messages }: { messages: any[] }) {
  return <div className="trace-messages">
    {messages.map((message, index) => <article className="trace-message" key={`${message?.timestamp ?? index}-${index}`}>
      <header><span>{message?.role ?? "message"}</span><CopyButton label="消息" value={message} /></header>
      <pre>{textFromTraceMessage(message)}</pre>
    </article>)}
  </div>;
}

function RequestView({ payload, index }: { payload: any; index: number }) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const skills = messages.filter(isSkillMessage);
  const conversation = messages.filter((message: any) => !isSkillMessage(message));
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const conversationCount = typeof payload?.messageCount === "number" && payload.messageCount !== conversation.length
    ? `${conversation.length} shown / ${payload.messageCount} sent`
    : `${conversation.length}`;
  return <section className="trace-section trace-request">
    <div className="trace-section-heading"><h3>LLM Request {index + 1}</h3><span>实际提交前的语义请求</span></div>
    <dl className="trace-facts"><dt>Model</dt><dd>{payload?.model?.provider ?? "—"}/{payload?.model?.id ?? "—"}</dd></dl>
    <details className="trace-detail" open>
      <summary><span>System prompt</span><em>{payload?.systemPrompt ? "已注入" : "未提供"}</em></summary>
      <div className="trace-detail-body"><CopyButton label="系统提示词" value={payload?.systemPrompt ?? ""} /><pre>{traceText(payload?.systemPrompt)}</pre></div>
    </details>
    {skills.length > 0 && <details className="trace-detail" open>
      <summary><span>Skills context</span><em>{skills.length}</em></summary>
      <div className="trace-detail-body"><MessageList messages={skills} /></div>
    </details>}
    <details className="trace-detail" open>
      <summary><span>Conversation</span><em>{conversationCount}</em></summary>
      <div className="trace-detail-body"><MessageList messages={conversation} /></div>
    </details>
    <details className="trace-detail">
      <summary><span>Tools</span><em>{tools.length}</em></summary>
      <div className="trace-detail-body"><CopyButton label="工具定义" value={tools} /><Json value={tools} /></div>
    </details>
    <details className="trace-detail">
      <summary><span>Options</span></summary>
      <div className="trace-detail-body"><Json value={payload?.options ?? {}} /></div>
    </details>
  </section>;
}

function ResponseView({ payload, index }: { payload: any; index: number }) {
  const message = payload?.message ?? payload;
  const toolCalls = toolCallsFromContent(message?.content);
  const heading = toolCalls.length > 0 ? `LLM Tool Decision ${index + 1}` : `LLM Response ${index + 1}`;
  const usage = usageFacts(message?.usage);
  return <details className="trace-section trace-response-detail" open>
    <summary className="trace-section-heading"><h3>{heading}</h3><span>{toolCalls.length > 0 ? `${toolCalls.length} tool call${toolCalls.length > 1 ? "s" : ""}` : traceText(message?.role, "assistant")}</span></summary>
    {toolCalls.length > 0 && <div className="trace-tool-decisions">
      {toolCalls.map((toolCall: any, toolIndex: number) => <div className="trace-tool-decision" key={toolCall?.id ?? toolIndex}>
        <span>模型请求调用</span><strong>{traceText(toolCall?.name, "tool")}</strong><code>{traceText(toolCall?.id, "—")}</code>
      </div>)}
    </div>}
    <div className="trace-response"><header><span>{traceText(message?.role, "assistant")}</span><CopyButton label="模型响应" value={message} /></header><pre>{textFromContent(message?.content ?? message)}</pre></div>
    {message?.usage && <details className="trace-detail" open>
      <summary><span>Response usage</span><em>{usageSummary(usage) ?? "available"}</em></summary>
      <div className="trace-detail-body">
        <dl className="trace-facts">
          {typeof usage?.input === "number" && <><dt>Input</dt><dd>{usage.input} tokens</dd></>}
          {typeof usage?.output === "number" && <><dt>Output</dt><dd>{usage.output} tokens</dd></>}
          {typeof usage?.total === "number" && <><dt>Total</dt><dd>{usage.total} tokens</dd></>}
          {typeof usage?.cached === "number" && <><dt>Cached</dt><dd>{usage.cached} tokens</dd></>}
          {typeof usage?.reasoning === "number" && <><dt>Reasoning</dt><dd>{usage.reasoning} tokens</dd></>}
        </dl>
        <details className="trace-detail">
          <summary><span>Raw usage</span><em>JSON</em></summary>
          <div className="trace-detail-body"><Json value={message.usage} /></div>
        </details>
      </div>
    </details>}
  </details>;
}

function ToolView({ payload }: { payload: any }) {
  return <div className="trace-tool"><Wrench size={14} /><strong>{traceText(payload?.name, "tool")}</strong><span>{traceText(payload?.state, "")}</span><details><summary>Arguments and result</summary><div className="trace-detail-body"><CopyButton label="工具调用" value={payload} /><Json value={payload} /></div></details></div>;
}

function ToolEntryView({ payload }: { payload: any }) {
  return <section className="trace-section trace-tool-section">
    <div className="trace-section-heading"><h3>Tool {traceText(payload?.name, "tool")}</h3><span>{traceText(payload?.state, "")}</span></div>
    <ToolView payload={payload} />
  </section>;
}

function spanText(range: { fromSeq?: number; toSeq?: number } | undefined) {
  if (!range || typeof range.fromSeq !== "number" || typeof range.toSeq !== "number") return null;
  return `${range.fromSeq}..${range.toSeq}`;
}

function tokenDiagnosticText(label: string, value: { tokens?: number; exact?: boolean } | undefined) {
  if (!value || typeof value.tokens !== "number") return null;
  return `${value.exact ? "exact" : "estimated"} ${label}: ${value.tokens} tokens`;
}

function CompactionEntryView({ payload }: { payload: CompactionTracePayload }) {
  const coverage = spanText(payload.coverage);
  const retainedTail = spanText(payload.retainedTail);
  const meta = [payload.trigger, payload.kind].filter(Boolean).join(" · ");
  const before = tokenDiagnosticText("before", payload.diagnostics?.before);
  const after = tokenDiagnosticText("after", payload.diagnostics?.after);
  const summaryUsage = typeof payload.summaryUsage?.totalTokens === "number"
    ? `${payload.summaryUsage.exact ? "exact" : "estimated"} summary: ${payload.summaryUsage.totalTokens} tokens`
    : null;
  return <section className="trace-section trace-compaction-section">
    <div className="trace-section-heading"><h3>Compaction {payload.state}</h3><span>{meta}</span></div>
    <dl className="trace-facts">
      {coverage && <><dt>Coverage</dt><dd>coverage {coverage}</dd></>}
      {retainedTail && <><dt>Retained</dt><dd>{retainedTail}</dd></>}
      {typeof payload.compactThroughSeq === "number" && <><dt>Through</dt><dd>{payload.compactThroughSeq}</dd></>}
      {typeof payload.retainedFromSeq === "number" && <><dt>Tail from</dt><dd>{payload.retainedFromSeq}</dd></>}
      {typeof payload.retainedTokenCount === "number" && <><dt>Tail tokens</dt><dd>{payload.retainedTokenCount}</dd></>}
      {payload.checkpointId && <><dt>Checkpoint</dt><dd>{payload.checkpointId}</dd></>}
      {before && <><dt>Before</dt><dd>{before}</dd></>}
      {after && <><dt>After</dt><dd>{after}</dd></>}
      {summaryUsage && <><dt>Summary</dt><dd>{summaryUsage}</dd></>}
      {payload.reason && <><dt>Reason</dt><dd>{payload.reason}</dd></>}
      {payload.error && <><dt>Error</dt><dd>{payload.error}</dd></>}
    </dl>
    <details className="trace-detail">
      <summary><span>Diagnostics</span><em>{payload.diagnostics ? "available" : "event"}</em></summary>
      <div className="trace-detail-body"><CopyButton label="压缩事件" value={payload} /><Json value={payload} /></div>
    </details>
  </section>;
}

export function Workbench({ nodeId }: { nodeId: string | null }) {
  const [tabs, setTabs] = useState<WorkbenchPageId[]>(restoredTabs);
  const [selectedTab, setSelectedTab] = useState<WorkbenchPageId | null>(() => restoredTabs()[0] ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [trace, setTrace] = useState<any>(null);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const readingHistoryRef = useRef(false);
  const open = (page: WorkbenchPageId = "trace") => {
    setTabs((current) => current.includes(page) ? current : [...current, page]);
    setSelectedTab(page);
    setMenuOpen(false);
  };
  const close = (page: WorkbenchPageId) => {
    setTabs((current) => {
      const next = current.filter((item) => item !== page);
      setSelectedTab((selected) => selected === page ? next[0] ?? null : selected);
      return next;
    });
    if (page === "trace") setTrace(null);
    setHasNewActivity(false);
  };
  useEffect(() => {
    localStorage.setItem("loom:workbench:tabs", JSON.stringify(tabs));
    localStorage.setItem("loom:workbench:trace", tabs.length ? "1" : "0");
  }, [tabs]);
  useEffect(() => {
    if (menuOpen) menuRef.current?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!nodeId || !tabs.length || !window.api) {
      setTrace(null);
      setHasNewActivity(false);
      return;
    }
    let dead = false;
    setTrace(null);
    window.api.canvas.trace(nodeId).then((snapshot) => !dead && setTrace(snapshot));
    const off = window.api.canvas.onTrace((snapshot) => {
      if (snapshot?.nodeId !== nodeId || dead) return;
      if (readingHistoryRef.current) setHasNewActivity(true);
      setTrace((current: any) => acceptTraceSnapshot(current, snapshot, nodeId));
    });
    return () => { dead = true; off(); };
  }, [nodeId, tabs]);
  if (!tabs.length) return <div className="workbench-empty"><div className="workbench-choices" role="menu" aria-label="打开工作台页面"><button role="menuitem" onClick={() => open()}><Activity size={18} /><span>Trace</span><kbd>⌘R</kbd></button></div></div>;
  const menu = menuOpen && menuPosition ? createPortal(
    <div ref={menuRef} className="workbench-menu" role="menu" tabIndex={-1} style={menuPosition} onKeyDown={(event) => { if (event.key === "Escape") { setMenuOpen(false); addRef.current?.focus(); } }}>
      {(Object.keys(WORKBENCH_PAGES) as WorkbenchPageId[]).map((page) => {
        const PageIcon = WORKBENCH_PAGES[page].icon;
        return <button key={page} role="menuitem" onClick={() => open(page)}><PageIcon size={14} />{WORKBENCH_PAGES[page].label}</button>;
      })}
    </div>,
    document.getElementById("app-overlay-root") ?? document.body,
  ) : null;
  return <div className="workbench-page">
    <div className="workbench-tabs" role="tablist">
      {tabs.map((page) => {
        const PageIcon = WORKBENCH_PAGES[page].icon;
        return <div className={`workbench-tab ${selectedTab === page ? "active" : ""}`} role="tab" tabIndex={0} aria-selected={selectedTab === page} key={page} onClick={() => setSelectedTab(page)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedTab(page); } }}><PageIcon size={14} /><span>{WORKBENCH_PAGES[page].label}</span><button aria-label={`关闭 ${WORKBENCH_PAGES[page].label}`} onClick={(event) => { event.stopPropagation(); close(page); }}><X size={13} /></button></div>;
      })}
      <div className="workbench-add-wrap"><button ref={addRef} className="workbench-add" aria-label="打开页面" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { const rect = addRef.current?.getBoundingClientRect(); setMenuPosition(rect ? { top: rect.bottom + 4, left: Math.max(8, rect.right - 160) } : null); setMenuOpen((open) => !open); }}><Plus size={16} /></button></div>
    </div>
    {menu}
    {selectedTab === "trace" && <div ref={inspectorRef} className="trace-inspector" role="tabpanel" aria-label="Trace" onScroll={(event) => {
      const element = event.currentTarget;
      const atNewest = element.scrollTop <= 24;
      readingHistoryRef.current = !atNewest;
      if (atNewest) setHasNewActivity(false);
    }}>
      {hasNewActivity && <button className="trace-new-activity" onClick={() => { inspectorRef.current?.scrollTo({ top: 0, behavior: "smooth" }); readingHistoryRef.current = false; setHasNewActivity(false); }}>有新的 Trace 活动</button>}
      {!nodeId ? <p>选择一个节点以查看 trace。</p> : !trace?.records?.length ? <p>此节点运行后，实际模型请求、响应和工具调用会出现在这里。</p> : trace.records.map((record: TraceRecord) => {
        const events = record.entries.filter((entry) => !["request", "response", "tool"].includes(entry.kind) && !(entry.kind === "event" && isCompactionPayload(entry.payload)));
        const visibleEntries = record.entries
          .filter((entry) => ["request", "response", "tool"].includes(entry.kind) || (entry.kind === "event" && isCompactionPayload(entry.payload)))
          .sort((a, b) => a.sequence - b.sequence);
        let requestIndex = 0;
        let responseIndex = 0;
        return <details className="trace-record" key={record.turnId}><summary><span className={`trace-state ${record.state}`}>{record.state}</span><strong>{record.operation}</strong><span className="trace-summary">{traceSummary(record)}</span><small>{record.turnId}</small><ChevronDown size={14} /></summary>
          {visibleEntries.map((entry) => {
            if (entry.kind === "request") return <RequestView key={entry.sequence} index={requestIndex++} payload={entry.payload} />;
            if (entry.kind === "response") return <ResponseView key={entry.sequence} index={responseIndex++} payload={entry.payload} />;
            if (entry.kind === "event" && isCompactionPayload(entry.payload)) return <CompactionEntryView key={entry.sequence} payload={entry.payload} />;
            return <ToolEntryView key={entry.sequence} payload={entry.payload} />;
          })}
          {events.length > 0 && <details className="trace-events"><summary>Events <em>{events.length}</em></summary><Json value={events.map((entry) => entry.payload)} /></details>}
        </details>;
      })}
    </div>}
  </div>;
}
