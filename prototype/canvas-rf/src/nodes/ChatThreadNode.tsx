import { useCallback, useContext, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BranchContext } from "../branch";

type Msg = { role: "user" | "assistant"; text: string };

function estimateTokens(data: any, mount: boolean): string {
  const own = (data.messages ?? []).reduce(
    (n: number, m: Msg) => n + m.text.length,
    0,
  );
  const seed = data.seed ? data.seed.text.length : 0;
  // rough CJK-ish estimate, plus a chunky ancestor cost when mounted
  const t = Math.round((own + seed) / 1.7) + (mount ? 780 : 0);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}

export function ChatThreadNode(props: any) {
  const { id, data } = props;
  const onBranch = useContext(BranchContext);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mount, setMount] = useState<boolean>(!!data.mountAncestors);

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
    setTb({
      text,
      x: r.left - box.left + r.width / 2,
      y: r.top - box.top - 6,
    });
  }, []);

  const doBranch = () => {
    if (tb && onBranch) onBranch(id, tb.text);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  const messages: Msg[] = data.messages ?? [];
  const lastText = messages.length ? messages[messages.length - 1].text : data.seed?.text ?? "";

  return (
    <div className={`card ${data.fresh ? "card--fresh" : ""}`}>
      <div className="card__head">
        <button
          className="chev"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "展开" : "折叠"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="title">{data.title}</span>
        <span className="model">{data.model}</span>
        <span className="spacer" />
        <span className="tokens">
          ~{estimateTokens(data, mount)} · 祖先:{mount ? "开" : "关"}
        </span>
      </div>

      {collapsed && <div className="preview">{lastText}</div>}

      {!collapsed && (
        <div className="card__body nodrag nowheel" ref={bodyRef} onMouseUp={onMouseUp}>
          {data.seed && (
            <div className="seed">
              <span className="seed__q">“{data.seed.text}”</span>
              <span className="seed__from">↗ 来自 {data.seed.from}</span>
            </div>
          )}

          {messages.length === 0 && (
            <div className="empty">顺着这个片段往下问…（输入框已就位）</div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>
              {m.text}
            </div>
          ))}

          {tb && (
            <div
              className="seltb"
              style={{ left: tb.x, top: tb.y }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button onClick={doBranch}>⑂ 岔出新节点</button>
              <button className="ghost" onClick={() => setTb(null)}>
                就地追问
              </button>
            </div>
          )}
        </div>
      )}

      {!collapsed && (
        <div className="card__foot nodrag">
          <input
            className="ask"
            placeholder={messages.length ? "继续追问…" : "顺着这个往下问…"}
          />
          <label className="mount" title="是否把根→父的完整路径也发给模型">
            <input
              type="checkbox"
              checked={mount}
              onChange={(e) => setMount(e.target.checked)}
            />
            挂载祖先
          </label>
        </div>
      )}

      <Handle type="target" position={Position.Top} className="h" />
      <Handle type="source" position={Position.Bottom} className="h" />
    </div>
  );
}
