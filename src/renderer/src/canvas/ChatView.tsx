import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ApprovalRequestPayload, ModelSelection, NodeBudget, NodeMsg, TurnCanvasEventPayload } from "../env";
import { IconSplit, IconProject } from "../icons";
import { Message } from "../message/Message";
import { Composer, type ComposerImage } from "../composer/Composer";
import { useTitlebarActions } from "../titlebar/Titlebar";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { groupToolTimelineMessages, isToolCanvasEventPayload, upsertToolTimelineMessage, type ToolCallView } from "./toolTimeline";
import { useComposerHeightVar } from "./useComposerHeightVar";
import { ApprovalPrompt, type ApprovalState } from "./ApprovalPrompt";

type Role = "user" | "assistant" | "error" | "tool";
type Msg = { id: number; role: Role; text: string; images?: ComposerImage[]; seq?: number; usage?: { totalTokens?: number }; meta?: unknown; toolCall?: ToolCallView };

function formatModelSelection(model?: ModelSelection) {
  if (!model) return undefined;
  return typeof model === "string" ? model : `${model.providerId}/${model.modelId}`;
}

function parseModelSelection(value: string): ModelSelection {
  const [providerId, ...rest] = value.trim().split("/");
  const modelId = rest.join("/");
  return providerId && modelId ? { providerId, modelId } : value.trim();
}

// 对话优先视图：单条主线摊开成经典居中聊天（「聊天 = 只有一个节点的画布」）。
// 走同一套 window.api.canvas；在回复里划词 → 岔出第一个分支 → 上层切成画布视图。
export default function ChatView({
  nodeId,
  initialMessages,
  initialMount,
  systemPrompt,
  model,
  onBranch,
  onExpandCanvas,
  noKey,
  goSettings,
}: {
  nodeId: string;
  initialMessages: NodeMsg[];
  initialMount: boolean;
  systemPrompt?: string;
  model?: ModelSelection;
  onBranch: (seedText: string) => void;
  onExpandCanvas: () => void;
  noKey: boolean;
  goSettings: () => void;
}) {
  const idRef = useRef(1);
  const initialMessagesRef = useRef({ nodeId, messages: initialMessages });
  const goSettingsRef = useRef(goSettings);
  goSettingsRef.current = goSettings;
  const seed = (initialMessages ?? []).map((m) => ({
    id: idRef.current++,
    role: m.role as Role,
    text: m.text,
    images: m.images,
    seq: m.seq,
    usage: m.usage,
    meta: m.meta,
    toolCall: m.toolCall,
  }));
  const [msgs, setMsgs] = useState<Msg[]>(seed);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [turn, setTurn] = useState<TurnCanvasEventPayload | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
  const [mount, setMount] = useState(initialMount);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(systemPrompt ?? "");
  const [nodeModel, setNodeModel] = useState<string | undefined>(formatModelSelection(model));
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);

  const openSettings = useCallback(() => {
    goSettingsRef.current();
  }, []);

  const titlebarActions = useMemo(
    () => (
      <>
        <button
          className="titlebar-button canvas-titlebar-action"
          type="button"
          onClick={onExpandCanvas}
          aria-label="展开画布"
          title="展开画布"
        >
          <IconProject size={15} />
        </button>
        {noKey && (
          <button className="chip-warn" type="button" onClick={openSettings}>
            未配置 API key · 去设置
          </button>
        )}
      </>
    ),
    [noKey, onExpandCanvas, openSettings],
  );
  useTitlebarActions(titlebarActions);

  const reloadFromInitial = useCallback((items: NodeMsg[]) => {
    setMsgs(items.map((m) => ({ id: idRef.current++, role: m.role, text: m.text, images: m.images, seq: m.seq, usage: m.usage, meta: m.meta, toolCall: m.toolCall })));
  }, []);

  const upsertToolMessage = useCallback((payload: Parameters<typeof upsertToolTimelineMessage<Msg>>[1]) => {
    setMsgs((current) => upsertToolTimelineMessage(current, payload, (toolCall) => ({
      id: idRef.current++,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    })));
  }, []);

  const refreshBudget = useCallback(async () => {
    if (window.api) setBudget(await window.api.canvas.budget(nodeId));
  }, [nodeId]);

  useEffect(() => {
    const previous = initialMessagesRef.current;
    if (previous.nodeId === nodeId && previous.messages === initialMessages) return;
    initialMessagesRef.current = { nodeId, messages: initialMessages };
    reloadFromInitial(initialMessages ?? []);
  }, [initialMessages, nodeId, reloadFromInitial]);

  useEffect(() => {
    setInput(localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
    setMount(initialMount);
    setPersona(systemPrompt ?? "");
    setNodeModel(formatModelSelection(model));
    refreshBudget();
  }, [initialMount, model, nodeId, refreshBudget, systemPrompt]);

  useEffect(() => {
    localStorage.setItem(`loom:draft:${nodeId}`, input);
  }, [nodeId, input]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.canvas.onEvent((e) => {
      if (e.nodeId !== nodeId) return;
      switch (e.type) {
        case "tool":
          {
            const payload = e.payload;
            if (isToolCanvasEventPayload(payload)) upsertToolMessage(payload);
          }
          break;
        case "approval":
          {
            const payload = e.payload as ApprovalRequestPayload;
            if (payload?.requestId && payload.nodeId === nodeId) setApproval({ ...payload, scope: payload.defaultScope });
          }
          break;
        case "turn":
          {
            const payload = e.payload as TurnCanvasEventPayload;
            if (!payload?.turnId) break;
            setTurn(payload);
            if (payload.state === "running") {
              setBusy(true);
              setApproval(null);
            } else if (payload.state === "awaiting_approval") {
              setBusy(true);
              setThinking(false);
            } else if (payload.state === "completed" || payload.state === "aborted" || payload.state === "failed") {
              setBusy(false);
              setThinking(false);
              setApproval(null);
            }
          }
          break;
        case "thinking":
          setThinking(true);
          break;
        case "assistant_start":
          setThinking(false);
          setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", text: "" }]);
          break;
        case "delta":
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "assistant") return m;
            const copy = m.slice();
            copy[copy.length - 1] = { ...last, text: last.text + String(e.payload ?? "") };
            return copy;
          });
          break;
        case "done":
          setThinking(false);
          setBusy(false);
          refreshBudget();
          break;
        case "error":
          setThinking(false);
          setBusy(false);
          setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: String(e.payload ?? "出错了") }]);
          break;
      }
    });
  }, [nodeId, refreshBudget, upsertToolMessage]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking, autoScroll]);

  // 悬浮输入框：把 composer 的实时高度回填给视图，滚动区据此留出底部空间。
  useComposerHeightVar(composerRef, rootRef);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !threadRef.current || !sel || sel.rangeCount === 0) {
      setTb(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!threadRef.current.contains(range.commonAncestorContainer)) {
      setTb(null);
      return;
    }
    const r = range.getBoundingClientRect();
    const box = threadRef.current.getBoundingClientRect();
    setTb({ text, x: r.left - box.left + r.width / 2, y: r.top - box.top - 6 });
  }, []);

  const doBranch = () => {
    if (tb) onBranch(tb.text);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  const streaming = busy && msgs[msgs.length - 1]?.role === "assistant";
  const awaitingApproval = turn?.state === "awaiting_approval" && approval;

  function submit(text: string, images: ComposerImage[] = []) {
    if (busy || (!text && images.length === 0)) return;
    setMsgs((m) => [...m, { id: idRef.current++, role: "user", text, images }]);
    setInput("");
    localStorage.removeItem(`loom:draft:${nodeId}`);
    if (!window.api) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: "浏览器预览：在 Electron 中运行（pnpm dev）以对话。" }]);
      return;
    }
    setBusy(true);
    setThinking(true);
    window.api.canvas.send(nodeId, text, images);
  }

  async function stop() {
    if (!window.api) return;
    await window.api.canvas.abort(nodeId);
  }

  async function decideApproval(action: "allow" | "deny", scope?: ApprovalState["scope"]) {
    if (!window.api || !approval) return;
    const current = approval;
    setApproval(null);
    await window.api.canvas.decideApproval({
      requestId: current.requestId,
      nodeId: current.nodeId,
      turnId: current.turnId,
      toolCallId: current.toolCallId,
      toolName: current.toolName,
      action,
      scope: action === "allow" ? scope ?? current.scope : undefined,
    });
  }

  async function regenerate() {
    if (!window.api || busy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const lastUser = [...m].map((x) => x.role).lastIndexOf("user");
      return lastUser >= 0 ? m.slice(0, lastUser + 1) : m;
    });
    await window.api.canvas.regenerate(nodeId);
  }

  async function editResend(seq: number | undefined, text: string) {
    if (!window.api || seq == null || busy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const idx = m.findIndex((x) => x.seq === seq);
      return idx >= 0 ? [...m.slice(0, idx), { id: idRef.current++, role: "user", text, seq }] : m;
    });
    await window.api.canvas.editResend({ nodeId, seq, text });
  }

  async function toggleMount(on: boolean) {
    setMount(on);
    if (!window.api) return;
    const r = await window.api.canvas.setMount(nodeId, on);
    if (r?.budget) setBudget(r.budget);
  }

  async function clearNode() {
    setMsgs([]);
    if (window.api) await window.api.canvas.reset(nodeId);
    refreshBudget();
  }

  async function savePersona() {
    await window.api?.canvas.setSystemPrompt(nodeId, persona);
    setPersonaOpen(false);
  }

  async function setModel(modelId: string) {
    const next = modelId.trim();
    if (!next || !window.api) return;
    const r = await window.api.canvas.setModel(nodeId, parseModelSelection(next));
    if (r.ok) setNodeModel(next);
  }

  function metaFor(m: Msg): string | undefined {
    const parts: string[] = [];
    const total = m.usage?.totalTokens;
    if (typeof total === "number") parts.push(`${total} tokens`);
    const meta = m.meta && typeof m.meta === "object" ? (m.meta as Record<string, unknown>) : {};
    const ms = meta.durationMs ?? meta.elapsedMs ?? meta.latencyMs;
    if (typeof ms === "number") parts.push(`${(ms / 1000).toFixed(1)}s`);
    return parts.length ? parts.join(" · ") : undefined;
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setTb(null);
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }

  return (
    <div className="chatview" ref={rootRef}>
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="thread" ref={threadRef} onMouseUp={onMouseUp}>
          {(personaOpen || nodeModel) && (
            <div className="chatview-nodebar nodrag">
              {nodeModel && <span className="model">{nodeModel}</span>}
              {personaOpen && (
                <div className="persona persona--chatview">
                  <textarea
                    value={persona}
                    placeholder="留空使用默认 system prompt"
                    onChange={(e) => setPersona(e.target.value)}
                  />
                  <button onClick={savePersona}>保存</button>
                </div>
              )}
            </div>
          )}
          {msgs.length === 0 && !thinking && (
            <div className="cv-empty">
              开始一段思考。
              <br />
              <span className="mono">在回复里划选文字，即可岔出一条分支</span>
            </div>
          )}
          {groupToolTimelineMessages(msgs).map((item) => (
            item.kind === "tools" ? (
              <ToolCallTimeline key={item.key} calls={item.calls} density="comfortable" />
            ) : (
              <Message
                key={item.message.id}
                role={item.message.role}
                text={item.message.text}
                images={item.message.images}
                density="comfortable"
                streaming={item.message.role === "assistant" && streaming && item.message.id === msgs[msgs.length - 1].id}
                meta={item.message.role === "assistant" ? metaFor(item.message) : undefined}
                canRegenerate={item.message.role === "assistant" && item.message.id === msgs[msgs.length - 1]?.id && !busy}
                canEdit={item.message.role === "user" && !busy}
                onRegenerate={regenerate}
                onEditResend={(text) => editResend(item.message.seq, text)}
                onRetry={item.message.role === "error" ? regenerate : undefined}
              />
            )
          ))}
          {thinking && (
            <div className="thinking">
              <span className="dot">·</span> 思考中…
            </div>
          )}
          {tb && (
            <div className="seltb" style={{ left: tb.x, top: tb.y }} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={doBranch}>
                <span><IconSplit size={13} /> 岔出分支</span>
                <small>{tb.text.length > 40 ? `${tb.text.slice(0, 40)}…` : tb.text}</small>
              </button>
            </div>
          )}
        </div>
      </div>
      {!autoScroll && (
        <button className="to-latest" type="button" aria-label="回到最新" title="回到最新" onClick={() => {
          setAutoScroll(true);
          requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }}>
          <ChevronDown size={18} />
        </button>
      )}
      <div className="composer" ref={composerRef}>
        <Composer
          nodeId={nodeId}
          value={input}
          onChange={setInput}
          busy={busy}
          placeholder={awaitingApproval ? "等待工具审批…" : busy ? "生成中…" : "随心输入…（Enter 发送，Shift+Enter 换行）"}
          topAccessory={awaitingApproval ? (
            <ApprovalPrompt
              approval={approval}
              onScopeChange={(scope) => setApproval((current) => current ? { ...current, scope } : current)}
              onDecision={decideApproval}
            />
          ) : undefined}
          mount={mount}
          canRegenerate={msgs.some((m) => m.role === "user") && !busy}
          budgetLine={`将发送 ~${(mount ? budget?.withAncestors : budget?.withoutAncestors) ?? 0} tokens`}
          onSubmit={submit}
          onStop={stop}
          onToggleMount={toggleMount}
          onOpenPersona={() => setPersonaOpen(true)}
          onClearNode={clearNode}
          onRegenerate={regenerate}
          onSetModel={setModel}
        />
      </div>
    </div>
  );
}
