import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NodeMsg } from "../env";
import { Message } from "../message/Message";
import { IconSend } from "../icons";

type Role = "user" | "assistant" | "error";
type Msg = { id: number; role: Role; text: string };

// 对话优先视图：单个根节点摊开成经典居中聊天（「聊天 = 只有一个节点的画布」）。
// 走同一套 window.api.canvas；在回复里划词 → 岔出第一个分支 → 上层切成画布视图。
export default function ChatView({
  nodeId,
  initialMessages,
  onBranch,
}: {
  nodeId: string;
  initialMessages: NodeMsg[];
  onBranch: (seedText: string) => void;
}) {
  const idRef = useRef(1);
  const seed = (initialMessages ?? []).map((m) => ({ id: idRef.current++, role: m.role as Role, text: m.text }));
  const [msgs, setMsgs] = useState<Msg[]>(seed);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);

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
          break;
        case "error":
          setThinking(false);
          setBusy(false);
          setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: String(e.payload ?? "出错了") }]);
          break;
      }
    });
  }, [nodeId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking]);

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

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { id: idRef.current++, role: "user", text }]);
    setInput("");
    if (!window.api) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: "浏览器预览：在 Electron 中运行（pnpm dev）以对话。" }]);
      return;
    }
    setBusy(true);
    setThinking(true);
    window.api.canvas.send(nodeId, text);
  }

  return (
    <div className="chatview">
      <div className="scroll" ref={scrollRef}>
        <div className="thread" ref={threadRef} onMouseUp={onMouseUp}>
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
              density="comfortable"
              streaming={m.role === "assistant" && streaming && m.id === msgs[msgs.length - 1].id}
            />
          ))}
          {thinking && (
            <div className="thinking">
              <span className="dot">·</span> 思考中…
            </div>
          )}
          {tb && (
            <div className="seltb" style={{ left: tb.x, top: tb.y }} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={doBranch}>⑂ 岔出新节点</button>
              <button className="ghost" onClick={() => setTb(null)}>取消</button>
            </div>
          )}
        </div>
      </div>
      <div className="composer">
        <div className="box">
          <textarea
            rows={1}
            placeholder="随心输入…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="send" onClick={submit} disabled={!input.trim() || busy}>
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}
