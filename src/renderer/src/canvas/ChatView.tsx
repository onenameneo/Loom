import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NodeBudget, NodeMsg } from "../env";
import { IconSplit } from "../icons";
import { Message } from "../message/Message";
import { Composer, type ComposerImage } from "../composer/Composer";

type Role = "user" | "assistant" | "error";
type Msg = { id: number; role: Role; text: string; images?: ComposerImage[]; seq?: number; usage?: { totalTokens?: number }; meta?: unknown };

// 对话优先视图：单条主线摊开成经典居中聊天（「聊天 = 只有一个节点的画布」）。
// 走同一套 window.api.canvas；在回复里划词 → 岔出第一个分支 → 上层切成画布视图。
export default function ChatView({
  nodeId,
  initialMessages,
  initialMount,
  systemPrompt,
  model,
  onBranch,
}: {
  nodeId: string;
  initialMessages: NodeMsg[];
  initialMount: boolean;
  systemPrompt?: string;
  model?: string;
  onBranch: (seedText: string) => void;
}) {
  const idRef = useRef(1);
  const seed = (initialMessages ?? []).map((m) => ({
    id: idRef.current++,
    role: m.role as Role,
    text: m.text,
    images: m.images,
    seq: m.seq,
    usage: m.usage,
    meta: m.meta,
  }));
  const [msgs, setMsgs] = useState<Msg[]>(seed);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
  const [mount, setMount] = useState(initialMount);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(systemPrompt ?? "");
  const [nodeModel, setNodeModel] = useState<string | undefined>(model);
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);

  const reloadFromInitial = useCallback((items: NodeMsg[]) => {
    setMsgs(items.map((m) => ({ id: idRef.current++, role: m.role, text: m.text, images: m.images, seq: m.seq, usage: m.usage, meta: m.meta })));
  }, []);

  const refreshBudget = useCallback(async () => {
    if (window.api) setBudget(await window.api.canvas.budget(nodeId));
  }, [nodeId]);

  useEffect(() => {
    reloadFromInitial(initialMessages ?? []);
  }, [initialMessages, reloadFromInitial]);

  useEffect(() => {
    setInput(localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
    setMount(initialMount);
    setPersona(systemPrompt ?? "");
    setNodeModel(model);
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
  }, [nodeId, refreshBudget]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking, autoScroll]);

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
    const r = await window.api.canvas.setModel(nodeId, next);
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
    <div className="chatview">
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
          {msgs.map((m) => (
            <Message
              key={m.id}
              role={m.role}
              text={m.text}
              images={m.images}
              density="comfortable"
              streaming={m.role === "assistant" && streaming && m.id === msgs[msgs.length - 1].id}
              meta={m.role === "assistant" ? metaFor(m) : undefined}
              canRegenerate={m.role === "assistant" && m.id === msgs[msgs.length - 1]?.id && !busy}
              canEdit={m.role === "user" && !busy}
              onRegenerate={regenerate}
              onEditResend={(text) => editResend(m.seq, text)}
              onRetry={m.role === "error" ? regenerate : undefined}
            />
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
        {!autoScroll && (
          <button className="to-latest" onClick={() => {
            setAutoScroll(true);
            requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }}>
            ↓ 回到最新
          </button>
        )}
      </div>
      <div className="composer">
        <Composer
          nodeId={nodeId}
          value={input}
          onChange={setInput}
          busy={busy}
          placeholder={busy ? "生成中…" : "随心输入…（Enter 发送，Shift+Enter 换行）"}
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
