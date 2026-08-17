import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Brain, Check, Copy, Pencil, RefreshCcw } from "lucide-react";
import type { NodeMsg } from "../env";
import { IconSplit } from "../icons";
import { MessageBranchDialog, type MessageBranchMode } from "../ui/dialogs";
import { CodeBlock } from "./CodeBlock";

export type MsgRole = "user" | "assistant" | "error" | "tool" | "skill" | "checkpoint";
export type Density = "compact" | "comfortable";
type CheckpointInfo = NonNullable<NodeMsg["checkpoint"]>;
const CHECKPOINT_SUMMARY_LIMIT = 4_000;

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

function rangeText(range?: { fromSeq: number; toSeq: number }, prefix = "") {
  return range ? `${prefix}${range.fromSeq}..${range.toSeq}` : undefined;
}

function tokenText(value?: { tokens: number; exact: boolean }) {
  if (!value) return undefined;
  return `${value.exact ? "" : "~"}${value.tokens}`;
}

function tokenDetail(label: string, value?: { tokens: number; exact: boolean }) {
  if (!value) return undefined;
  return `${value.exact ? "exact" : "estimated"} ${label}: ${value.tokens} tokens`;
}

function boundedSummary(text: string) {
  return text.length > CHECKPOINT_SUMMARY_LIMIT
    ? `${text.slice(0, CHECKPOINT_SUMMARY_LIMIT).trimEnd()}\n\n[summary truncated]`
    : text;
}

function CheckpointView({ checkpoint, text }: { checkpoint?: CheckpointInfo; text: string }) {
  const title = checkpoint?.kind === "frozen-branch" ? "Frozen branch summary" : "Context checkpoint";
  const coverage = rangeText(checkpoint?.coverage, "covers ");
  const retainedTail = rangeText(checkpoint?.retainedTail, "tail ");
  const before = tokenText(checkpoint?.diagnostics.before);
  const after = tokenText(checkpoint?.diagnostics.after);
  const budget = before && after ? `${before} -> ${after} tokens` : undefined;
  const summaryTotal = checkpoint?.summaryUsage?.totalTokens;
  const summaryExact = checkpoint?.summaryUsage?.exact;
  const summaryUsage = typeof summaryTotal === "number" ? `${summaryExact ? "" : "~"}${summaryTotal} summary request tokens` : undefined;
  const beforeDetail = tokenDetail("before", checkpoint?.diagnostics.before);
  const afterDetail = tokenDetail("after", checkpoint?.diagnostics.after);
  const summaryCost = typeof summaryTotal === "number" ? `${summaryExact ? "exact" : "estimated"} summary request cost: ${summaryTotal} tokens` : undefined;
  const summary = boundedSummary(text);

  return (
    <details className="m__checkpoint" open={checkpoint?.reason === "manual" ? true : undefined}>
      <summary>
        <BookOpen size={13} />
        <span>{title}</span>
        {checkpoint?.reason && <em>{checkpoint.reason}</em>}
      </summary>
      <div className="m__checkpoint-body">
        {coverage && <span>{coverage}</span>}
        {retainedTail && <span>{retainedTail}</span>}
        {budget && <span>{budget}</span>}
        {summaryUsage && <span>{summaryUsage}</span>}
      </div>
      <div className="m__checkpoint-detail">
        <section>
          <h4>Projected context budget</h4>
          <dl>
            {beforeDetail && <><dt>Before</dt><dd>{beforeDetail}</dd></>}
            {afterDetail && <><dt>After</dt><dd>{afterDetail}</dd></>}
            {summaryCost && <><dt>Summary request</dt><dd>{summaryCost}</dd></>}
          </dl>
        </section>
        {summary && (
          <section>
            <h4>Checkpoint summary</h4>
            <div className="m__checkpoint-summary">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {summary}
              </ReactMarkdown>
            </div>
          </section>
        )}
      </div>
    </details>
  );
}

function ThinkingView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`m__thinking ${open ? "is-open" : "is-collapsed"}`}>
      <button
        className="m__thinking-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Brain size={13} />
        <span>Thinking</span>
      </button>
      <div className={`m__thinking-collapse ${open ? "" : "is-collapsed"}`} aria-hidden={!open}>
        <div className="m__thinking-body">{text}</div>
      </div>
    </div>
  );
}

// 共用消息组件：画布节点与 ChatView 都用它。助手消息渲染 Markdown，其余纯文本。
export function Message({
  role,
  text,
  thinking,
  images,
  density = "comfortable",
  streaming = false,
  meta,
  checkpoint,
  canRegenerate = false,
  canEdit = false,
  onRegenerate,
  onEditResend,
  onRetry,
  sourceSeq,
  onBranch,
  messageSeq,
}: {
  role: MsgRole;
  text: string;
  thinking?: string;
  images?: { data: string; mimeType: string }[];
  density?: Density;
  streaming?: boolean;
  meta?: string;
  checkpoint?: CheckpointInfo;
  canRegenerate?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEditResend?: (text: string) => void;
  onRetry?: () => void;
  sourceSeq?: number;
  onBranch?: (mode: MessageBranchMode, sourceSeq: number) => void | Promise<void>;
  messageSeq?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [branchOpen, setBranchOpen] = useState(false);

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
    <div className={`m m--${role} m--${density}`} data-message-seq={typeof messageSeq === "number" ? messageSeq : undefined}>
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
        {typeof sourceSeq === "number" && onBranch && (
          <button onClick={() => setBranchOpen(true)} title="分支" aria-label="分支">
            <IconSplit size={13} />
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
      ) : role === "checkpoint" ? (
        <CheckpointView checkpoint={checkpoint} text={text} />
      ) : role === "skill" ? (
        <span className="m__plain m__skill"><BookOpen size={13} /> {text}</span>
      ) : role === "assistant" ? (
        <div className="m__md">
          {thinking && <ThinkingView text={thinking} />}
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
      {branchOpen && typeof sourceSeq === "number" && onBranch && (
        <MessageBranchDialog
          open={branchOpen}
          onOpenChange={setBranchOpen}
          onSelect={(mode) => onBranch(mode, sourceSeq)}
        />
      )}
    </div>
  );
}
