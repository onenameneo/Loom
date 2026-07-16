import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import { Check, Settings, Trash2 } from "lucide-react";
import type { NodeBudget, NodeMsg } from "../env";
import { Composer, type ComposerImage } from "../composer/Composer";
import { IconArrowUpRight, IconChevronRight, IconSplit } from "../icons";
import { Message } from "../message/Message";
import { BranchContext } from "./branch";

type Role = "user" | "assistant" | "error";
type Msg = { id: number; role: Role; text: string; images?: ComposerImage[]; seq?: number; usage?: { totalTokens?: number }; meta?: unknown };

// 画布节点 = 一个活的 pi 对话线程（「索引卡片」）。发消息走 window.api.canvas，
// 订阅本 nodeId 的流式事件；头部显示 token 预算（含/不含祖先）与挂载开关。
export function ChatThreadNode(props: any) {
  const { id, data } = props;
  const branch = useContext(BranchContext);
  const bodyRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const toMsgs = useCallback((items: NodeMsg[] = []) => (
    items.map((m) => ({ id: idRef.current++, role: m.role as Role, text: m.text, images: m.images, seq: m.seq, usage: m.usage, meta: m.meta }))
  ), []);

  const [msgs, setMsgs] = useState<Msg[]>(() => toMsgs(data.messages ?? []));
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${id}`) ?? "");
  const [mount, setMount] = useState<boolean>(!!data.mountAncestors);
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [title, setTitle] = useState(String(data.title ?? ""));
  const [editingTitle, setEditingTitle] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(String(data.systemPrompt ?? ""));
  const [nodeModel, setNodeModel] = useState<string | undefined>(data.model);

  useEffect(() => {
    setMsgs(toMsgs(data.messages ?? []));
    setTitle(String(data.title ?? ""));
    setPersona(String(data.systemPrompt ?? ""));
    setNodeModel(data.model);
  }, [data.messages, data.title, data.systemPrompt, data.model, toMsgs]);

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

  // 订阅本节点的流式事件
  useEffect(() => {
    refreshBudget();
    if (!window.api) return;
    return window.api.canvas.onEvent((e) => {
      if (e.nodeId !== id) return;
      switch (e.type) {
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
  }, [id, refreshBudget, reloadNode]);

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
    setTb({
      text,
      x: r.left - box.left + bodyRef.current.scrollLeft + r.width / 2,
      y: r.top - box.top + bodyRef.current.scrollTop - 8,
    });
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
  const tokens = budget ? (mount ? budget.withAncestors : budget.withoutAncestors) : null;
  const tokenLabel =
    tokens == null ? "—" : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
  const streaming = busy && msgs[msgs.length - 1]?.role === "assistant";
  const hasChildren = Boolean(data.hasChildren);
  const treeCollapsed = Boolean(data.isTreeCollapsed);
  const collapsedCount = Number(data.collapsedCount ?? 0);

  return (
    <div className={`card ${data.fresh ? "card--fresh" : ""}`}>
      <NodeResizer
        minWidth={288}
        minHeight={220}
        isVisible={Boolean(props.selected)}
        lineClassName="rz-line"
        handleClassName="rz-handle"
      />
      <div className="card__head">
        {hasChildren && (
          <button
            className={`tree-toggle nodrag ${treeCollapsed ? "is-collapsed" : ""}`}
            onClick={() => data.onToggleCollapse?.(id)}
            title={treeCollapsed ? "展开子树" : "折叠子树"}
          >
            <IconChevronRight size={13} />
            {treeCollapsed && collapsedCount > 0 && <span>+{collapsedCount}</span>}
          </button>
        )}
        {editingTitle ? (
          <input
            className="title-edit nodrag"
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
          <button className="title title-btn nodrag" onDoubleClick={() => setEditingTitle(true)} onClick={() => data.onSelect?.(id)}>
            {title}
          </button>
        )}
        {nodeModel && <span className="model">{nodeModel}</span>}
        <span className="spacer" />
        <span className="tokens" title={budget?.estimated ? "将发送的估算 token（字符估算，随挂载祖先变化）" : undefined}>
          {budget?.estimated ? "~" : ""}
          {tokenLabel} tok
        </span>
        <button className="head-icon nodrag" title="节点 persona" onClick={() => setPersonaOpen((v) => !v)}>
          <Settings size={13} />
        </button>
        {!data.isRoot && (
          <button className="head-icon danger nodrag" title="删除分支" onClick={() => data.onDelete?.(id)}>
            <Trash2 size={13} />
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

          {msgs.map((m, i) => (
            <Message
              key={i}
              role={m.role}
              text={m.text}
              images={m.images}
              density="compact"
              streaming={m.role === "assistant" && streaming && i === msgs.length - 1}
              meta={m.role === "assistant" ? metaFor(m) : undefined}
              canRegenerate={m.role === "assistant" && i === msgs.length - 1 && !busy}
              canEdit={m.role === "user" && !busy}
              onRegenerate={regenerate}
              onEditResend={(text) => editResend(m.seq, text)}
              onRetry={m.role === "error" ? regenerate : undefined}
            />
          ))}

          {thinking && <div className="thinking"><span className="dot">·</span> 思考中…</div>}

          {tb && (
            <div className="seltb" style={{ left: tb.x, top: tb.y }} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={doBranch}>
                <span><IconSplit size={13} /> 岔出分支</span>
                <small>{tb.text.length > 40 ? `${tb.text.slice(0, 40)}…` : tb.text}</small>
              </button>
            </div>
          )}
          {!autoScroll && (
            <button
              className="to-latest to-latest--card nodrag"
              onClick={() => {
                setAutoScroll(true);
                requestAnimationFrame(() => {
                  const el = bodyRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                });
              }}
            >
              ↓ 回到最新
            </button>
          )}
      </div>

      <div className="card__foot nodrag">
        <Composer
          nodeId={id}
          value={input}
          onChange={setInput}
          busy={busy}
          placeholder={busy ? "回复中…" : msgs.length ? "继续追问…" : data.seed ? "顺着这个往下问…" : "开始一段思考…"}
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
