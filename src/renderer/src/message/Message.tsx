import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Check, Copy, Pencil, RefreshCcw } from "lucide-react";
import { CodeBlock } from "./CodeBlock";

export type MsgRole = "user" | "assistant" | "error" | "tool" | "skill";
export type Density = "compact" | "comfortable";

// react-markdown 组件覆盖：围栏代码块 → CodeBlock（高亮/复制），行内 code → token 化，
// 链接 → 新窗口（经主进程 window-open handler 走系统浏览器）。不启用 rehype-raw（转义 HTML）。
const mdComponents = {
  pre: (props: any) => <>{props.children}</>,
  code: ({ className, children }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    const raw = String(children ?? "");
    if (match || raw.includes("\n")) {
      return <CodeBlock code={raw.replace(/\n$/, "")} lang={match?.[1]} />;
    }
    return <code className="inline-code">{children}</code>;
  },
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

// 共用消息组件：画布节点与 ChatView 都用它。助手消息渲染 Markdown，其余纯文本。
export function Message({
  role,
  text,
  images,
  density = "comfortable",
  streaming = false,
  meta,
  canRegenerate = false,
  canEdit = false,
  onRegenerate,
  onEditResend,
  onRetry,
}: {
  role: MsgRole;
  text: string;
  images?: { data: string; mimeType: string }[];
  density?: Density;
  streaming?: boolean;
  meta?: string;
  canRegenerate?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEditResend?: (text: string) => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {
      /* clipboard 不可用时静默 */
    }
  }

  function submitEdit() {
    const next = draft.trim();
    if (!next) return;
    onEditResend?.(next);
    setEditing(false);
  }

  return (
    <div className={`m m--${role} m--${density}`}>
      <div className="m__bar nodrag">
        <button onClick={copy} title="复制">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {canRegenerate && (
          <button onClick={onRegenerate} title="重答">
            <RefreshCcw size={13} />
          </button>
        )}
        {canEdit && (
          <button onClick={() => setEditing((v) => !v)} title="编辑重发">
            <Pencil size={13} />
          </button>
        )}
        {meta && <span className="m__meta">{meta}</span>}
      </div>

      {images && images.length > 0 && (
        <div className="m__images">
          {images.map((image, index) => (
            <img key={`${image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt="" />
          ))}
        </div>
      )}

      {editing ? (
        <div className="m__edit nodrag">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitEdit();
            }}
            autoFocus
          />
          <div>
            <button onClick={() => setEditing(false)}>取消</button>
            <button className="primary" onClick={submitEdit}>重发</button>
          </div>
        </div>
      ) : role === "skill" ? (
        <span className="m__plain m__skill"><BookOpen size={13} /> {text}</span>
      ) : role === "assistant" ? (
        <div className="m__md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {text}
          </ReactMarkdown>
          {streaming && <span className="m__caret" />}
        </div>
      ) : (
        <span className="m__plain">{text}</span>
      )}
      {role === "error" && onRetry && (
        <button className="m__retry nodrag" onClick={onRetry}>重试</button>
      )}
    </div>
  );
}
