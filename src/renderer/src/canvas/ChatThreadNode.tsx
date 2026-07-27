import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizeControl, Position, type ResizeParams } from "@xyflow/react";
import { Check, ChevronDown, MessageSquareText, Pencil, Trash2 } from "lucide-react";
import type { ApprovalRequestPayload, NodeBudget, NodeMsg, TurnCanvasEventPayload } from "../env";
import { Composer, type ComposerImage } from "../composer/Composer";
import { IconArrowUpRight, IconChevronRight, IconSplit } from "../icons";
import { Message } from "../message/Message";
import { BranchContext } from "./branch";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { groupToolTimelineMessages, isToolCanvasEventPayload, upsertToolTimelineMessage, type ToolCallView } from "./toolTimeline";
import { useComposerHeightVar } from "./useComposerHeightVar";
import { ApprovalPrompt, type ApprovalState } from "./ApprovalPrompt";

type Role = "user" | "assistant" | "error" | "tool";
type Msg = { id: number; role: Role; text: string; images?: ComposerImage[]; seq?: number; usage?: { totalTokens?: number }; meta?: unknown; toolCall?: ToolCallView };
type SelectionToolbar = { text: string; x: number; y: number; place: "top" | "bottom"; arrowX: number };
type RectLike = Pick<DOMRect, "left" | "top" | "bottom" | "width" | "height">;

export function selectionToolbarFromRects({
  text,
  selection,
  container,
  scrollLeft,
  scrollTop,
  clientWidth,
  zoom,
}: {
  text: string;
  selection: RectLike;
  container: RectLike;
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  zoom: number;
}): SelectionToolbar | null {
  if (selection.width === 0 && selection.height === 0) return null;
  const scale = zoom > 0 ? zoom : 1;
  const toolbarWidth = Math.min(240, Math.max(0, clientWidth - 24));
  const toolbarHalf = toolbarWidth / 2;
  const gutter = 12;
  const selectionCenterX = (selection.left - container.left + selection.width / 2) / scale;
  const rawX = scrollLeft + selectionCenterX;
  const minX = scrollLeft + gutter + toolbarHalf;
  const maxX = scrollLeft + clientWidth - gutter - toolbarHalf;
  const x = maxX >= minX ? Math.min(Math.max(rawX, minX), maxX) : rawX;
  const arrowX = Math.min(Math.max(rawX - x + toolbarHalf, 14), Math.max(14, toolbarWidth - 14));
  const selectionGap = 16;
  const preferredTop = scrollTop + (selection.top - container.top) / scale - selectionGap;
  const toolbarHeight = 104;
  const place = preferredTop - toolbarHeight < scrollTop + gutter ? "bottom" : "top";

  return {
    text,
    x,
    y: place === "top"
      ? preferredTop
      : scrollTop + (selection.bottom - container.top) / scale + selectionGap,
    place,
    arrowX,
  };
}

// macOS Finder 式颜色标签（存语义名，渲染走 --label-* token，明暗自适配）。
const NODE_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;

// 画布节点 = 一个活的 pi 对话线程（「索引卡片」）。发消息走 window.api.canvas，
// 订阅本 nodeId 的流式事件；头部显示 token 预算（含/不含祖先）与挂载开关。
export function ChatThreadNode(props: any) {
  const { id, data } = props;
  const branch = useContext(BranchContext);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const toMsgs = useCallback((items: NodeMsg[] = []) => (
    items.map((m) => ({ id: idRef.current++, role: m.role as Role, text: m.text, images: m.images, seq: m.seq, usage: m.usage, meta: m.meta, toolCall: m.toolCall }))
  ), []);

  const [msgs, setMsgs] = useState<Msg[]>(() => toMsgs(data.messages ?? []));
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [turn, setTurn] = useState<TurnCanvasEventPayload | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${id}`) ?? "");
  const [mount, setMount] = useState<boolean>(!!data.mountAncestors);
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [tb, setTb] = useState<SelectionToolbar | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [title, setTitle] = useState(String(data.title ?? ""));
  const [editingTitle, setEditingTitle] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(String(data.systemPrompt ?? ""));
  const [nodeModel, setNodeModel] = useState<string | undefined>(data.model);
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const resizeTokenRef = useRef<number | null>(null);
  const color = typeof data.color === "string" ? data.color : "";

  useEffect(() => {
    resizeTokenRef.current = null;
  }, [data.resizeControlEpoch]);

  useEffect(() => {
    setMsgs(toMsgs(data.messages ?? []));
    setTitle(String(data.title ?? ""));
    setPersona(String(data.systemPrompt ?? ""));
    setNodeModel(data.model);
  }, [data.messages, data.title, data.systemPrompt, data.model, toMsgs]);

  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!colorRef.current?.contains(e.target as Node)) setColorOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [colorOpen]);

  const refreshBudget = useCallback(async () => {
    if (!window.api) return;
    setBudget(await window.api.canvas.budget(id));
  }, [id]);

  const reloadNode = useCallback(async () => {
    if (!window.api || !data.workspaceId) return;
    const list = await window.api.canvas.list(data.workspaceId);
    const next = list.find((n) => n.id === id);
    if (next) {
      setMsgs(toMsgs(next.messages));
      setTitle(next.title);
      setPersona(next.systemPrompt ?? "");
      setNodeModel(next.model);
    }
  }, [data.workspaceId, id, toMsgs]);

  const upsertToolMessage = useCallback((payload: Parameters<typeof upsertToolTimelineMessage<Msg>>[1]) => {
    setMsgs((current) => upsertToolTimelineMessage(current, payload, (toolCall) => ({
      id: idRef.current++,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    })));
  }, []);

  useEffect(() => {
    setInput(localStorage.getItem(`loom:draft:${id}`) ?? "");
  }, [id]);

  useEffect(() => {
    localStorage.setItem(`loom:draft:${id}`, input);
  }, [id, input]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking, autoScroll]);

  // 悬浮输入框：把 foot 的实时高度回填给卡片，正文据此留出底部空间，
  // 让消息可以滚到输入框下方并在渐隐里淡出（而非被一块实心 foot 顶开）。
  useComposerHeightVar(footRef, cardRef);

  // 订阅本节点的流式事件
  useEffect(() => {
    refreshBudget();
    if (!window.api) return;
    return window.api.canvas.onEvent((e) => {
      if (e.nodeId !== id) return;
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
            if (payload?.requestId && payload.nodeId === id) setApproval({ ...payload, scope: payload.defaultScope });
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
              setThinking(false);
              setBusy(false);
              setApproval(null);
              refreshBudget();
              reloadNode();
            }
          }
          break;
        case "thinking":
          setThinking(true);
          setBusy(true);
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
          reloadNode();
          break;
        case "error":
          setThinking(false);
          setBusy(false);
          setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: String(e.payload ?? "出错了") }]);
          break;
      }
    });
  }, [id, refreshBudget, reloadNode, upsertToolMessage]);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !bodyRef.current || !sel || sel.rangeCount === 0) {
      setTb(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!bodyRef.current.contains(range.commonAncestorContainer)) {
      setTb(null);
      return;
    }
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setTb(null);
      return;
    }
    const box = bodyRef.current.getBoundingClientRect();
    const el = bodyRef.current;
    const zoom = box.width > 0 && el.clientWidth > 0 ? box.width / el.clientWidth : 1;
    const toolbar = selectionToolbarFromRects({
      text,
      selection: r,
      container: box,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      clientWidth: el.clientWidth,
      zoom,
    });
    setTb(toolbar);
  }, []);

  const doBranch = () => {
    if (tb) branch?.onBranch(id, tb.text);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  async function toggleMount(on: boolean) {
    setMount(on);
    if (!window.api) return;
    const r = await window.api.canvas.setMount(id, on);
    if (r?.budget) setBudget(r.budget);
  }

  function submit(text: string, images: ComposerImage[] = []) {
    if (busy || (!text && images.length === 0)) return;
    setMsgs((m) => [...m, { id: idRef.current++, role: "user", text, images }]);
    setInput("");
    localStorage.removeItem(`loom:draft:${id}`);
    if (!window.api) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: "浏览器预览：在 Electron 中运行（pnpm dev）以对话。" }]);
      return;
    }
    setBusy(true);
    setThinking(true);
    window.api.canvas.send(id, text, images);
  }

  async function stop() {
    if (window.api) await window.api.canvas.abort(id);
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
    await window.api.canvas.regenerate(id);
    await reloadNode();
  }

  async function editResend(seq: number | undefined, text: string) {
    if (!window.api || seq == null || busy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const idx = m.findIndex((x) => x.seq === seq);
      return idx >= 0 ? [...m.slice(0, idx), { id: idRef.current++, role: "user", text, seq }] : m;
    });
    await window.api.canvas.editResend({ nodeId: id, seq, text });
    await reloadNode();
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next) return;
    setEditingTitle(false);
    await data.onRename?.(id, next);
  }

  async function savePersona() {
    await window.api?.canvas.setSystemPrompt(id, persona);
    setPersonaOpen(false);
    data.onTreeChange?.();
  }

  async function clearNode() {
    setMsgs([]);
    if (window.api) await window.api.canvas.reset(id);
    refreshBudget();
  }

  async function setModel(model: string) {
    const next = model.trim();
    if (!next || !window.api) return;
    const r = await window.api.canvas.setModel(id, next);
    if (r.ok) {
      setNodeModel(next);
      data.onTreeChange?.();
    }
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

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    setTb(null);
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }

  const seedText = String(data.seed?.text ?? "");
  const seedPreview = seedText.length > 42 ? `${seedText.slice(0, 42)}…` : seedText;
  const titleEditUnits = Array.from(title || "标题").reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  const titleEditWidth = `${Math.min(Math.max(titleEditUnits + 2, 8), 36)}ch`;
  const tokens = budget ? (mount ? budget.withAncestors : budget.withoutAncestors) : null;
  const tokenLabel =
    tokens == null ? "—" : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
  const streaming = busy && msgs[msgs.length - 1]?.role === "assistant";
  const awaitingApproval = turn?.state === "awaiting_approval" && approval;
  const hasChildren = Boolean(data.hasChildren);
  const treeCollapsed = Boolean(data.isTreeCollapsed);
  const collapsedCount = Number(data.collapsedCount ?? 0);

  return (
    <div className={`card ${data.fresh ? "card--fresh" : ""}`} ref={cardRef}>
      {Boolean(props.selected) && (
        <NodeResizeControl
          key={data.resizeControlEpoch}
          nodeId={id}
          position="bottom-right"
          minWidth={288}
          minHeight={220}
          style={{
            left: "auto",
            top: "auto",
            right: 0,
            bottom: 0,
            width: 22,
            height: 22,
            transform: "none",
            transformOrigin: "bottom right",
          }}
          className="node-resize-control nodrag nopan"
          onResizeStart={(_, params: ResizeParams) => {
            resizeTokenRef.current = data.onResizeStart?.(id, params) ?? null;
          }}
          shouldResize={(_, params: ResizeParams) => {
            const token = resizeTokenRef.current;
            return token != null && Boolean(data.shouldResize?.(id, token, params));
          }}
          onResize={(_, params: ResizeParams) => {
            if (resizeTokenRef.current != null) {
              data.onResize?.(id, resizeTokenRef.current, params);
            }
          }}
          onResizeEnd={(_, params: ResizeParams) => {
            if (resizeTokenRef.current != null) {
              data.onResizeEnd?.(id, resizeTokenRef.current, params);
            }
            resizeTokenRef.current = null;
          }}
        >
          <span className="node-resize-corner" aria-hidden="true" />
        </NodeResizeControl>
      )}
      <div className="card__head">
        <div className="node-color nodrag" ref={colorRef}>
          <button
            className={`color-dot ${color ? "is-set" : ""}`}
            style={color ? { background: `var(--label-${color})` } : undefined}
            title="颜色标签"
            onClick={() => setColorOpen((v) => !v)}
          />
          {colorOpen && (
            <div className="color-pop">
              <button
                className="color-swatch is-none"
                title="无色"
                onClick={() => {
                  data.onSetColor?.(id, "");
                  setColorOpen(false);
                }}
              >
                {!color && <Check size={11} />}
              </button>
              {NODE_COLORS.map((c) => (
                <button
                  key={c}
                  className="color-swatch"
                  style={{ background: `var(--label-${c})` }}
                  title={c}
                  onClick={() => {
                    data.onSetColor?.(id, c);
                    setColorOpen(false);
                  }}
                >
                  {color === c && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="head-main">
          {editingTitle ? (
            <input
              className="title-edit nodrag"
              style={{ width: titleEditWidth }}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitle(String(data.title ?? ""));
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <div className="title-row">
              <span className="title title-text" title={title}>
                {title}
              </span>
              <button
                className="title-edit-btn nodrag"
                type="button"
                title="编辑标题"
                aria-label="编辑标题"
                onClick={() => setEditingTitle(true)}
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <div className="head-meta">
            {nodeModel && <span className="model" title={nodeModel}>{nodeModel}</span>}
            <span className="tokens" title={budget?.estimated ? "将发送的估算 token（字符估算，随挂载祖先变化）" : undefined}>
              {budget?.estimated ? "~" : ""}
              {tokenLabel} tok
            </span>
          </div>
        </div>
        <button
          className="head-icon nodrag"
          type="button"
          title="回到聊天模式"
          aria-label="回到聊天模式"
          onClick={() => data.onReturnChat?.(id)}
        >
          <MessageSquareText size={13} />
        </button>
        {!data.isRoot && (
          <button className="head-icon danger nodrag" title="删除分支" onClick={() => data.onDelete?.(id)}>
            <Trash2 size={13} />
          </button>
        )}
        {hasChildren && (
          <button
            className={`tree-toggle nodrag ${treeCollapsed ? "is-collapsed" : ""}`}
            onClick={() => data.onToggleCollapse?.(id)}
            title={treeCollapsed ? `展开子树（${collapsedCount}）` : "折叠子树"}
          >
            <IconChevronRight size={14} />
            {treeCollapsed && collapsedCount > 0 && <span className="tree-count">{collapsedCount}</span>}
          </button>
        )}
      </div>

      {personaOpen && (
        <div className="persona nodrag">
          <textarea
            value={persona}
            placeholder="留空使用默认 system prompt"
            onChange={(e) => setPersona(e.target.value)}
          />
          <button onClick={savePersona}>
            <Check size={13} /> 保存
          </button>
        </div>
      )}

      <div
        className="card__body nodrag nowheel"
        ref={bodyRef}
        onMouseUp={onMouseUp}
        onScroll={onBodyScroll}
        onBlur={() => setTb(null)}
      >
          {data.seed && (
            <button
              className="seed seed--chip nodrag"
              type="button"
              onClick={() => branch?.onFocusNode?.(data.seed.parent, { flash: true })}
              title="跳到来源节点"
            >
              <span className="seed__from">来自 {data.seed.from}</span>
              <span className="seed__q">“{seedPreview}”</span>
              <IconArrowUpRight size={13} />
            </button>
          )}

          {msgs.length === 0 && !thinking && (
            <div className="empty">{data.seed ? "顺着这个片段往下问…" : "从主线开始一段思考…"}</div>
          )}

          {groupToolTimelineMessages(msgs).map((item) => (
            item.kind === "tools" ? (
              <ToolCallTimeline key={item.key} calls={item.calls} density="compact" />
            ) : (
              <Message
                key={item.message.id}
                role={item.message.role}
                text={item.message.text}
                images={item.message.images}
                density="compact"
                streaming={item.message.role === "assistant" && streaming && item.message.id === msgs[msgs.length - 1]?.id}
                meta={item.message.role === "assistant" ? metaFor(item.message) : undefined}
                canRegenerate={item.message.role === "assistant" && item.message.id === msgs[msgs.length - 1]?.id && !busy}
                canEdit={item.message.role === "user" && !busy}
                onRegenerate={regenerate}
                onEditResend={(text) => editResend(item.message.seq, text)}
                onRetry={item.message.role === "error" ? regenerate : undefined}
              />
            )
          ))}

          {thinking && <div className="thinking"><span className="dot">·</span> 思考中…</div>}

          {tb && (
            <div
              className={`seltb seltb--${tb.place}`}
              style={{ left: tb.x, top: tb.y, "--seltb-arrow-x": `${tb.arrowX}px` } as CSSProperties}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button onClick={doBranch}>
                <span><IconSplit size={13} /> 岔出分支</span>
                <small>{tb.text.length > 40 ? `${tb.text.slice(0, 40)}…` : tb.text}</small>
              </button>
            </div>
          )}
      </div>

      {!autoScroll && (
        <button
          className="to-latest to-latest--card nodrag"
          type="button"
          aria-label="回到最新"
          title="回到最新"
          onClick={() => {
            setAutoScroll(true);
            requestAnimationFrame(() => {
              const el = bodyRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }}
        >
          <ChevronDown size={18} />
        </button>
      )}

      <div className="card__foot nodrag" ref={footRef}>
        <Composer
          nodeId={id}
          value={input}
          onChange={setInput}
          busy={busy}
          placeholder={awaitingApproval ? "等待工具审批…" : busy ? "回复中…" : msgs.length ? "继续追问…" : data.seed ? "顺着这个往下问…" : "开始一段思考…"}
          topAccessory={awaitingApproval ? (
            <ApprovalPrompt
              approval={approval}
              compact
              onScopeChange={(scope) => setApproval((current) => current ? { ...current, scope } : current)}
              onDecision={decideApproval}
            />
          ) : undefined}
          mount={mount}
          canRegenerate={msgs.some((m) => m.role === "user") && !busy}
          onSubmit={submit}
          onStop={stop}
          onToggleMount={toggleMount}
          onOpenPersona={() => setPersonaOpen(true)}
          onClearNode={clearNode}
          onRegenerate={regenerate}
          onSetModel={setModel}
        />
      </div>

      <Handle type="target" position={Position.Left} className="h" />
      <Handle type="source" position={Position.Right} className="h" />
    </div>
  );
}
