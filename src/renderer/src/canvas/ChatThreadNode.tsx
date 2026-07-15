import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeBudget } from "../env";
import { Message } from "../message/Message";
import { BranchContext } from "./branch";

type Role = "user" | "assistant" | "error";
type Msg = { role: Role; text: string };

// 画布节点 = 一个活的 pi 对话线程（「索引卡片」）。发消息走 window.api.canvas，
// 订阅本 nodeId 的流式事件；头部显示 token 预算（含/不含祖先）与挂载开关。
export function ChatThreadNode(props: any) {
  const { id, data } = props;
  const onBranch = useContext(BranchContext);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [msgs, setMsgs] = useState<Msg[]>(() => data.messages ?? []);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mount, setMount] = useState<boolean>(!!data.mountAncestors);
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);

  const refreshBudget = useCallback(async () => {
    if (!window.api) return;
    setBudget(await window.api.canvas.budget(id));
  }, [id]);

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
          setMsgs((m) => [...m, { role: "assistant", text: "" }]);
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
          setMsgs((m) => [...m, { role: "error", text: String(e.payload ?? "出错了") }]);
          break;
      }
    });
  }, [id, refreshBudget]);

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
    const box = bodyRef.current.getBoundingClientRect();
    setTb({ text, x: r.left - box.left + r.width / 2, y: r.top - box.top - 6 });
  }, []);

  const doBranch = () => {
    if (tb && onBranch) onBranch(id, tb.text);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  async function toggleMount(on: boolean) {
    setMount(on);
    if (!window.api) return;
    const r = await window.api.canvas.setMount(id, on);
    if (r?.budget) setBudget(r.budget);
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    if (!window.api) {
      setMsgs((m) => [...m, { role: "error", text: "浏览器预览：在 Electron 中运行（pnpm dev）以对话。" }]);
      return;
    }
    setBusy(true);
    setThinking(true);
    window.api.canvas.send(id, text);
  }

  const tokens = budget ? (mount ? budget.withAncestors : budget.withoutAncestors) : null;
  const tokenLabel =
    tokens == null ? "—" : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
  const streaming = busy && msgs[msgs.length - 1]?.role === "assistant";
  const lastText = msgs.length ? msgs[msgs.length - 1].text : data.seed?.text ?? "";

  return (
    <div className={`card ${data.fresh ? "card--fresh" : ""}`}>
      <div className="card__head">
        <button className="chev nodrag" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "展开" : "折叠"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="title">{data.title}</span>
        {data.model && <span className="model">{data.model}</span>}
        <span className="spacer" />
        <span className="tokens" title={budget?.estimated ? "估算值（字符估算）" : undefined}>
          {budget?.estimated ? "~" : ""}
          {tokenLabel} · 祖先:{mount ? "开" : "关"}
        </span>
      </div>

      {collapsed && <div className="preview">{lastText || "（空）"}</div>}

      {!collapsed && (
        <div className="card__body nodrag nowheel" ref={bodyRef} onMouseUp={onMouseUp}>
          {data.seed && (
            <div className="seed">
              <span className="seed__q">“{data.seed.text}”</span>
              <span className="seed__from">↗ 来自 {data.seed.from}</span>
            </div>
          )}

          {msgs.length === 0 && !thinking && (
            <div className="empty">{data.seed ? "顺着这个片段往下问…" : "开始一段思考…"}</div>
          )}

          {msgs.map((m, i) => (
            <Message
              key={i}
              role={m.role}
              text={m.text}
              density="compact"
              streaming={m.role === "assistant" && streaming && i === msgs.length - 1}
            />
          ))}

          {thinking && <div className="thinking"><span className="dot">·</span> 思考中…</div>}

          {tb && (
            <div className="seltb" style={{ left: tb.x, top: tb.y }} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={doBranch}>⑂ 岔出新节点</button>
              <button className="ghost" onClick={() => setTb(null)}>就地追问</button>
            </div>
          )}
        </div>
      )}

      {!collapsed && (
        <div className="card__foot nodrag">
          <input
            className="ask"
            placeholder={busy ? "回复中…" : msgs.length ? "继续追问…" : data.seed ? "顺着这个往下问…" : "开始一段思考…"}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <label className="mount" title="是否把根→父的完整路径也发给模型">
            <input type="checkbox" checked={mount} onChange={(e) => toggleMount(e.target.checked)} />
            挂载祖先
          </label>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="h" />
      <Handle type="source" position={Position.Right} className="h" />
    </div>
  );
}
