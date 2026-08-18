import { Activity, ChevronRight, Copy, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { readUsageFacts, type AgentMetricTotals, type UsageFacts } from "../../../common/telemetry";
import {
  applyTraceEvent,
  buildSpanTree,
  traceSnapshotToState,
  type TraceClientState,
  type TraceRecordDto,
  type TraceSpanDto,
  type TraceSpanNode,
} from "./traceState";

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

function spanDurationMs(span: TraceSpanDto) {
  if (typeof span.startedAt !== "number" || typeof span.endedAt !== "number") return "…";
  const ms = span.endedAt - span.startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function modelLabel(span: TraceSpanDto) {
  const model = span.attributes?.model as { provider?: string; id?: string } | undefined;
  if (model?.provider && model?.id) return `${model.provider}/${model.id}`;
  return span.name;
}

function traceSummary(record: TraceRecordDto) {
  const llm = record.spans.find((span) => span.kind === "llm_call");
  const model = llm ? modelLabel(llm) : "—";
  const duration = typeof record.startedAt === "number" && typeof record.endedAt === "number"
    ? `${((record.endedAt - record.startedAt) / 1000).toFixed(1)}s`
    : undefined;
  const usage = llm ? usageSummary(readUsageFacts((llm.attributes as any)?.usage)) : undefined;
  return [model, duration, usage].filter(Boolean).join(" · ");
}

function formatTokenCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(Math.round((value / 1_000_000 + Number.EPSILON) * 100) / 100).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(Math.round((value / 1_000 + Number.EPSILON) * 100) / 100).toFixed(2)}K`;
  return Math.round(value).toLocaleString();
}

function tokenValue(value: number | undefined) {
  return `${formatTokenCount(value)} tokens`;
}

function usageSummary(usage: UsageFacts | undefined) {
  if (!usage) return undefined;
  const parts = [
    typeof usage.input === "number" ? `in ${formatTokenCount(usage.input)}` : undefined,
    typeof usage.output === "number" ? `out ${formatTokenCount(usage.output)}` : undefined,
    typeof usage.cacheRead === "number" ? `cache ${formatTokenCount(usage.cacheRead)}` : undefined,
    typeof usage.total === "number" ? `total ${formatTokenCount(usage.total)}` : undefined,
    typeof usage.cost?.total === "number" ? `$${usage.cost.total.toFixed(4)}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" · ")}${usage.source ? ` · ${usage.source}` : ""} tokens` : undefined;
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
    {messages.map((message, index) => <article className="trace-message trace-message--reading" key={`${message?.timestamp ?? index}-${index}`}>
      <header><span>{message?.role ?? "message"}</span><CopyButton label="消息" value={message} /></header>
      <pre>{textFromTraceMessage(message)}</pre>
    </article>)}
  </div>;
}

function SpanStatus({ status }: { status: string }) {
  return <span className={`trace-state ${status}`}>{status}</span>;
}

function disclosureId(turnId: string, span: TraceSpanDto, detail: string) {
  return `${turnId}-${span.spanId}-${detail}`;
}

type DisclosurePhase = "opening" | "open" | "closing" | "closed";

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Design.md exception: this controlled wrapper keeps an inert body mounted through exit/reopen animation and hands focus back to its trigger; a stock Radix primitive cannot provide that product-semantic lifecycle without reimplementing it.
function TraceDisclosure({ id, label, summary, children, className, triggerClassName, triggerContent }: {
  id: string;
  label: string;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  triggerContent?: ReactNode;
}) {
  const [phase, setPhase] = useState<DisclosurePhase>("closed");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const open = phase === "opening" || phase === "open";
  const bodyId = `trace-disclosure-body-${id}`;

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
  }, []);
  useEffect(() => { bodyRef.current?.toggleAttribute("inert", !open); }, [open]);

  function toggle() {
    window.clearTimeout(timerRef.current);
    if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = undefined;
    if (open) {
      if (bodyRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      if (prefersReducedMotion()) {
        setPhase("closed");
      } else {
        setPhase("closing");
        timerRef.current = window.setTimeout(() => setPhase("closed"), 200);
      }
    } else {
      if (prefersReducedMotion()) {
        setPhase("open");
      } else {
        setPhase("opening");
        // Keep the initial state through a paint, then transition. One frame can
        // be coalesced with the state update and skip the opening animation.
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = undefined;
            setPhase("open");
          });
        });
      }
    }
  }

  return <section className={`trace-disclosure${className ? ` ${className}` : ""}`} data-phase={phase}>
    <button ref={triggerRef} type="button" className={`trace-disclosure__trigger${triggerClassName ? ` ${triggerClassName}` : ""}`} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
      {triggerContent ?? <><ChevronRight className="trace-disclosure__chevron" aria-hidden="true" size={14} /><span>{label}</span>{summary && <em>{summary}</em>}</>}
    </button>
    <div ref={bodyRef} id={bodyId} data-testid={bodyId} className="trace-disclosure__body" hidden={phase === "closed"} aria-hidden={!open}>
      <div className="trace-disclosure__content">{children}</div>
    </div>
  </section>;
}

function LlmSpanView({ span, turnId }: { span: TraceSpanNode; turnId: string }) {
  const attrs = span.attributes as Record<string, any>;
  const messages = Array.isArray(attrs.messages) ? attrs.messages : [];
  const skills = messages.filter(isSkillMessage);
  const conversation = messages.filter((message: any) => !isSkillMessage(message));
  const tools = Array.isArray(attrs.tools) ? attrs.tools : [];
  const usage = readUsageFacts(attrs.usage);
  const response = attrs.response;
  return <section className="trace-section trace-request trace-timeline-event">
    <div className="trace-section-heading">
      <h3>LLM Call</h3>
      <span>{spanDurationMs(span)} · <SpanStatus status={span.status} /></span>
    </div>
    <dl className="trace-facts">
      <dt>Model</dt><dd>{modelLabel(span)}</dd>
      {usage && <><dt>Usage</dt><dd>{usageSummary(usage)}</dd></>}
    </dl>
    {usage && <TraceDisclosure id={disclosureId(turnId, span, "response-usage")} label="Response usage" summary={usageSummary(usage)}>
      <div className="trace-detail-body">
        <dl className="trace-facts">
          {typeof usage.input === "number" && <><dt>Input</dt><dd>{tokenValue(usage.input)}</dd></>}
          {typeof usage.output === "number" && <><dt>Output</dt><dd>{tokenValue(usage.output)}</dd></>}
          {typeof usage.total === "number" && <><dt>Total</dt><dd>{tokenValue(usage.total)}</dd></>}
          {typeof usage.cacheRead === "number" && <><dt>Cache read</dt><dd>{tokenValue(usage.cacheRead)}</dd></>}
          {typeof usage.cacheWrite === "number" && <><dt>Cache write</dt><dd>{tokenValue(usage.cacheWrite)}</dd></>}
          {typeof usage.reasoning === "number" && <><dt>Reasoning</dt><dd>{tokenValue(usage.reasoning)}</dd></>}
          {typeof usage.cost?.total === "number" && <><dt>Cost</dt><dd>${usage.cost.total.toFixed(4)}</dd></>}
          {usage.source && <><dt>Accounting</dt><dd>{usage.source}</dd></>}
        </dl>
      </div>
    </TraceDisclosure>}
    {response != null && <TraceDisclosure id={disclosureId(turnId, span, "response")} label="Response" summary="completed">
      <div className="trace-detail-body trace-response"><CopyButton label="响应" value={traceText(response)} /><pre>{traceText(response)}</pre></div>
    </TraceDisclosure>}
    {attrs.systemPrompt != null && <TraceDisclosure id={disclosureId(turnId, span, "system-prompt")} label="System prompt" summary="已注入">
      <div className="trace-detail-body"><CopyButton label="系统提示词" value={attrs.systemPrompt} /><pre>{traceText(attrs.systemPrompt)}</pre></div>
    </TraceDisclosure>}
    {skills.length > 0 && <TraceDisclosure id={disclosureId(turnId, span, "skills-context")} label="Skills context" summary={skills.length}>
      <div className="trace-detail-body"><MessageList messages={skills} /></div>
    </TraceDisclosure>}
    <TraceDisclosure id={disclosureId(turnId, span, "conversation")} label="Conversation" summary={conversation.length}>
      <div className="trace-detail-body"><MessageList messages={conversation} /></div>
    </TraceDisclosure>
    {tools.length > 0 && <TraceDisclosure id={disclosureId(turnId, span, "tools")} label="Tools" summary={tools.length}>
      <div className="trace-detail-body"><CopyButton label="工具定义" value={tools} /><Json value={tools} /></div>
    </TraceDisclosure>}
    {attrs.options != null && <TraceDisclosure id={disclosureId(turnId, span, "options")} label="Options">
      <div className="trace-detail-body"><Json value={attrs.options} /></div>
    </TraceDisclosure>}
    {span.children.length > 0 && <div className="trace-span-children">
      {span.children.map((child) => <SpanView key={child.spanId} span={child} turnId={turnId} />)}
    </div>}
  </section>;
}

function ToolSpanView({ span, turnId }: { span: TraceSpanNode; turnId: string }) {
  const attrs = span.attributes as Record<string, any>;
  const usage = readUsageFacts(attrs.usage);
  return <section className="trace-section trace-tool-section trace-timeline-event">
    <div className="trace-section-heading">
      <h3>Tool {span.name}</h3>
      <span>{attrs.id != null && <code>{String(attrs.id)}</code>}{attrs.id != null ? " · " : ""}{spanDurationMs(span)} · <SpanStatus status={span.status} /></span>
    </div>
    <TraceDisclosure id={disclosureId(turnId, span, "tool-arguments")} label="Arguments and result">
      <div className="trace-detail-body"><CopyButton label="工具调用" value={span.attributes} /><Json value={span.attributes} /></div>
    </TraceDisclosure>
    {usage && <dl className="trace-facts"><dt>Usage</dt><dd>{usageSummary(usage)}</dd></dl>}
  </section>;
}

function spanText(range: { fromSeq?: number; toSeq?: number } | undefined) {
  if (!range || typeof range.fromSeq !== "number" || typeof range.toSeq !== "number") return null;
  return `${range.fromSeq}..${range.toSeq}`;
}

function tokenDiagnosticText(label: string, value: { tokens?: number; exact?: boolean } | undefined) {
  if (!value || typeof value.tokens !== "number") return null;
  return `${value.exact ? "exact" : "estimated"} ${label}: ${tokenValue(value.tokens)}`;
}

function CompactionSpanView({ span, turnId }: { span: TraceSpanNode; turnId: string }) {
  const payload = span.attributes as unknown as CompactionTracePayload;
  const coverage = spanText(payload.coverage);
  const retainedTail = spanText(payload.retainedTail);
  const meta = [payload.trigger, payload.kind].filter(Boolean).join(" · ");
  const before = tokenDiagnosticText("before", payload.diagnostics?.before);
  const after = tokenDiagnosticText("after", payload.diagnostics?.after);
  const summaryUsage = typeof payload.summaryUsage?.totalTokens === "number"
    ? `${payload.summaryUsage.exact ? "exact" : "estimated"} summary: ${tokenValue(payload.summaryUsage.totalTokens)}`
    : null;
  return <section className="trace-section trace-compaction-section trace-timeline-event">
    <div className="trace-section-heading">
      <h3>Compaction {payload.state ?? span.status}</h3>
      <span>{meta} · {spanDurationMs(span)}</span>
    </div>
    <dl className="trace-facts">
      {coverage && <><dt>Coverage</dt><dd>coverage {coverage}</dd></>}
      {retainedTail && <><dt>Retained</dt><dd>{retainedTail}</dd></>}
      {typeof payload.compactThroughSeq === "number" && <><dt>Through</dt><dd>{payload.compactThroughSeq}</dd></>}
      {typeof payload.retainedFromSeq === "number" && <><dt>Tail from</dt><dd>{payload.retainedFromSeq}</dd></>}
      {typeof payload.retainedTokenCount === "number" && <><dt>Tail tokens</dt><dd>{tokenValue(payload.retainedTokenCount)}</dd></>}
      {payload.checkpointId && <><dt>Checkpoint</dt><dd>{payload.checkpointId}</dd></>}
      {before && <><dt>Before</dt><dd>{before}</dd></>}
      {after && <><dt>After</dt><dd>{after}</dd></>}
      {summaryUsage && <><dt>Summary</dt><dd>{summaryUsage}</dd></>}
      {payload.reason && <><dt>Reason</dt><dd>{payload.reason}</dd></>}
      {payload.error && <><dt>Error</dt><dd>{payload.error}</dd></>}
    </dl>
    <TraceDisclosure id={disclosureId(turnId, span, "compaction-diagnostics")} label="Diagnostics" summary={payload.diagnostics ? "available" : "event"}>
      <div className="trace-detail-body"><CopyButton label="压缩事件" value={span.attributes} /><Json value={span.attributes} /></div>
    </TraceDisclosure>
  </section>;
}

function SpanView({ span, turnId }: { span: TraceSpanNode; turnId: string }) {
  if (span.kind === "llm_call") return <LlmSpanView span={span} turnId={turnId} />;
  if (span.kind === "tool") return <ToolSpanView span={span} turnId={turnId} />;
  if (span.kind === "compaction") return <CompactionSpanView span={span} turnId={turnId} />;
  // turn 根 span：渲染其子 span 树
  return <div className="trace-span-children">
    {span.children.map((child) => <SpanView key={child.spanId} span={child} turnId={turnId} />)}
  </div>;
}

function TraceRecordView({ record }: { record: TraceRecordDto }) {
  const tree = buildSpanTree(record.spans);
  return <TraceDisclosure id={`turn-${record.turnId}`} label={record.operation} className="trace-record" triggerClassName="trace-record__summary" triggerContent={<>
      <SpanStatus status={record.status} />
      <strong>{record.operation}</strong>
      <span className="trace-summary">{traceSummary(record)}</span>
      <small>{record.turnId}</small>
      <ChevronRight className="trace-disclosure__chevron trace-record__chevron" aria-hidden="true" size={14} />
    </>}>
    {tree.map((node) => <SpanView key={node.spanId} span={node} turnId={record.turnId} />)}
  </TraceDisclosure>;
}

export function Workbench({ nodeId }: { nodeId: string | null }) {
  const [tabs, setTabs] = useState<WorkbenchPageId[]>(restoredTabs);
  const [selectedTab, setSelectedTab] = useState<WorkbenchPageId | null>(() => restoredTabs()[0] ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [trace, setTrace] = useState<TraceClientState | null>(null);
  const [metrics, setMetrics] = useState<AgentMetricTotals | null>(null);
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
      setMetrics(null);
      setHasNewActivity(false);
      return;
    }
    let dead = false;
    setTrace(null);
    setMetrics(null);
    // 先订阅再取快照：订阅累积优先，初始快照只在更新于订阅时应用。
    const off = window.api.canvas.onTrace((event) => {
      if (event?.nodeId !== nodeId || dead) return;
      if (readingHistoryRef.current) setHasNewActivity(true);
      setTrace((current) => applyTraceEvent(current, event, nodeId));
      if (event.type === "turn_end" && typeof window.api.canvas.metrics === "function") {
        window.api.canvas.metrics(nodeId).then((result) => {
          if (!dead) setMetrics(result ?? null);
        });
      }
    });
    window.api.canvas.trace(nodeId).then((snapshot) => {
      if (dead) return;
      setTrace((current) => {
        const state = traceSnapshotToState(snapshot);
        return current && current.revision >= state.revision ? current : state;
      });
    });
    if (typeof window.api.canvas.metrics === "function") {
      window.api.canvas.metrics(nodeId).then((result) => {
        if (!dead) setMetrics(result ?? null);
      });
    }
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
      {metrics && <section className="trace-section trace-metrics-summary" aria-label="Usage summary">
        <div className="trace-section-heading"><div><h3>Usage summary</h3><p>当前节点的历史累计</p></div><span className="trace-metrics-summary__scope">LIFETIME</span></div>
        <div className="trace-metrics-summary__hero">
          <div className="trace-metric-card trace-metric-card--primary"><span>Total tokens</span><strong>{formatTokenCount(readUsageFacts(metrics.usage)?.total)}</strong></div>
          {typeof metrics.usage?.cost?.total === "number" && <div className="trace-metric-card"><span>Cost</span><strong>${metrics.usage.cost.total.toFixed(4)}</strong></div>}
        </div>
        <div className="trace-metrics-summary__grid" aria-label="运行指标">
          <div className="trace-metric-card"><span>Turns</span><strong>{metrics.turns}</strong></div>
          <div className="trace-metric-card"><span>LLM calls</span><strong>{metrics.llmRequests}</strong></div>
          <div className="trace-metric-card"><span>Tools</span><strong>{metrics.toolCalls}</strong></div>
          <div className="trace-metric-card"><span>Duration</span><strong>{(metrics.durationMs / 1000).toFixed(1)}s</strong></div>
          <div className="trace-metric-card"><span>TTFT avg</span><strong>{metrics.ttftSamples > 0 ? (metrics.ttftMs / metrics.ttftSamples / 1000).toFixed(1) : "—"} {metrics.ttftSamples > 0 && <small>s</small>}</strong></div>
          <div className="trace-metric-card"><span>LLM output rate</span><strong>{metrics.outputTokensPerSecond.toFixed(1)} <small>tok/s</small></strong></div>
        </div>
        {(() => {
          const usage = readUsageFacts(metrics.usage);
          if (!usage) return null;
          return <div className="trace-metrics-summary__tokens" aria-label="Token breakdown">
            {typeof usage.input === "number" && <div><span>Input</span><strong>{formatTokenCount(usage.input)}</strong></div>}
            {typeof usage.output === "number" && <div><span>Output</span><strong>{formatTokenCount(usage.output)}</strong></div>}
            {typeof usage.cacheRead === "number" && <div><span>Cache read</span><strong>{formatTokenCount(usage.cacheRead)}</strong></div>}
            {typeof usage.cacheWrite === "number" && <div><span>Cache write</span><strong>{formatTokenCount(usage.cacheWrite)}</strong></div>}
          </div>;
        })()}
      </section>}
      {!nodeId ? <p>选择一个节点以查看 trace。</p> : !trace?.order.length ? <p>此节点运行后，实际模型请求、响应和工具调用会出现在这里。</p> : [...trace.order].reverse().map((turnId) => {
        const record = trace.recordsByTurnId[turnId];
        return record ? <TraceRecordView key={record.turnId} record={record} /> : null;
      })}
    </div>}
  </div>;
}
