import { memo, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Brain, Check, Copy, FileText, Pencil, RefreshCcw } from "lucide-react";
import type { FileMentionRef } from "../../../common/fileMentions";
import type { LiveTurnContentPart } from "../../../common/liveTurns";
import type { SelectionContextNote } from "../../../common/selectionContext";
import type { NodeMsg } from "../env";
import { IconSplit } from "../icons";
import { MessageBranchDialog, type MessageBranchMode } from "../ui/dialogs";
import { buttonClassName, cn, fieldClassName } from "../ui/styles";
import { CodeBlock } from "./CodeBlock";
import { useI18n } from "../i18n/I18nProvider";
import { splitMarkdownBlocks } from "./markdownBlocks";

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
  const { t } = useI18n();
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
              <span>{t("message.thinkingLabel")}</span>
      </button>
      <div className={`m__thinking-collapse ${open ? "" : "is-collapsed"}`} aria-hidden={!open}>
        <div className="m__thinking-body">{text}</div>
      </div>
    </div>
  );
}

function AssistantContent({
  text,
  thinking,
  contentParts,
  streaming,
}: {
  text: string;
  thinking?: string;
  contentParts?: LiveTurnContentPart[];
  streaming: boolean;
}) {
  const parts = contentParts?.length
    ? contentParts
    : [
        ...(thinking ? [{ partId: "legacy-thinking", kind: "thinking" as const, text: thinking, sequence: 0 }] : []),
        { partId: "legacy-text", kind: "text" as const, text, sequence: 1 },
      ];
  return (
    <div className="m__md">
      {parts.map((part) => part.kind === "thinking" ? (
        <ThinkingView key={part.partId} text={part.text} />
      ) : (
        <div key={part.partId} className="m__md-part">
          {splitMarkdownBlocks(part.text).map((block, index) => (
            <ReactMarkdown key={`${part.partId}:block:${index}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
              {block}
            </ReactMarkdown>
          ))}
        </div>
      ))}
      {streaming && <span className="m__caret" />}
    </div>
  );
}

type MessageProps = {
  role: MsgRole;
  text: string;
  thinking?: string;
  contentParts?: LiveTurnContentPart[];
  images?: { data: string; mimeType: string }[];
  fileMentions?: FileMentionRef[];
  selectionNotes?: SelectionContextNote[];
  density?: Density;
  streaming?: boolean;
  meta?: string;
  checkpoint?: CheckpointInfo;
  canRegenerate?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEditResend?: (text: string) => void;
  onEditResendWithSeq?: (seq: number | undefined, text: string) => void;
  onRetry?: () => void;
  sourceSeq?: number;
  onBranch?: (mode: MessageBranchMode, sourceSeq: number) => void | Promise<void>;
  messageSeq?: number;
};

function equalMessageProps(previous: MessageProps, next: MessageProps) {
  return previous.role === next.role &&
    previous.text === next.text &&
    previous.thinking === next.thinking &&
    previous.contentParts === next.contentParts &&
    previous.images === next.images &&
    previous.fileMentions === next.fileMentions &&
    previous.selectionNotes === next.selectionNotes &&
    previous.density === next.density &&
    previous.streaming === next.streaming &&
    previous.meta === next.meta &&
    previous.checkpoint === next.checkpoint &&
    previous.canRegenerate === next.canRegenerate &&
    previous.canEdit === next.canEdit &&
    previous.sourceSeq === next.sourceSeq &&
    previous.messageSeq === next.messageSeq &&
    previous.onRegenerate === next.onRegenerate &&
    previous.onEditResend === next.onEditResend &&
    previous.onEditResendWithSeq === next.onEditResendWithSeq &&
    previous.onRetry === next.onRetry &&
    previous.onBranch === next.onBranch;
}

// 共用消息组件：画布节点与 ChatView 都用它。助手消息渲染 Markdown，其余纯文本。
export const Message = memo(function Message({
  role,
  text,
  thinking,
  contentParts,
  images,
  fileMentions,
  selectionNotes,
  density = "comfortable",
  streaming = false,
  meta,
  checkpoint,
  canRegenerate = false,
  canEdit = false,
  onRegenerate,
  onEditResend,
  onEditResendWithSeq,
  onRetry,
  sourceSeq,
  onBranch,
  messageSeq,
}: MessageProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [branchOpen, setBranchOpen] = useState(false);
  const editFieldId = useId();
  // Internal reasoning is a timeline state, not a user-facing answer. Keeping
  // its action bar hidden prevents controls from landing between Thinking and
  // the tool call that follows it.
  const showActionBar = role !== "assistant" || Boolean(text.trim());

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
    if (onEditResendWithSeq) onEditResendWithSeq(sourceSeq, next);
    else onEditResend?.(next);
    setEditing(false);
  }

  return (
    <div className={`m m--${role} m--${density} ${editing ? "m--editing" : ""}`} data-message-seq={typeof messageSeq === "number" ? messageSeq : undefined}>
      {images && images.length > 0 && (
        <div className="m__images">
          {images.map((image, index) => (
            <img key={`${image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt="" />
          ))}
        </div>
      )}

      {fileMentions && fileMentions.length > 0 && (
        <div className="m__file-mentions" aria-label={t("message.referencedFiles")}>
          {fileMentions.map((mention) => {
            const fileName = mention.path.split("/").pop() || mention.path;
            return (
              <div className="m__file-mention" key={`${mention.root}:${mention.path}`} title={`@${mention.root}/${mention.path}`}>
                <FileText size={13} aria-hidden="true" />
                <span className="m__file-mention-info">
                  <strong>@{fileName}</strong>
                  <small>{mention.path}</small>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectionNotes && selectionNotes.length > 0 && (
        <div className="m__selection-notes" aria-label={t("selection.contextNotes")}>
          {selectionNotes.map((note, index) => (
            <div className="m__selection-note" key={note.id || index}>
              <blockquote>{note.text}</blockquote>
              {note.annotation && (
                <div className="m__selection-note-annotation">
                  <span>{t("selection.annotationLabel")}：</span>{note.annotation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className={cn(fieldClassName, "m__edit nodrag")} data-state="open">
          <textarea
            id={editFieldId}
            value={draft}
            className="m__edit-input"
            aria-label={t("message.editResend")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitEdit();
            }}
            autoFocus
          />
          <div className="m__edit-actions">
            <button className={buttonClassName("default", "m__edit-cancel")} type="button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
            <button className={buttonClassName("primary", "m__edit-submit")} type="button" onClick={submitEdit}>
              {t("message.resend")}
            </button>
          </div>
        </div>
      ) : role === "checkpoint" ? (
        <CheckpointView checkpoint={checkpoint} text={text} />
      ) : role === "skill" ? (
        <span className="m__plain m__skill"><BookOpen size={13} /> {text}</span>
      ) : role === "assistant" ? (
        <AssistantContent text={text} thinking={thinking} contentParts={contentParts} streaming={streaming} />
      ) : text || !selectionNotes?.length ? (
        <span className="m__plain">{text}</span>
      ) : null}
      {showActionBar && !editing && (
        <div className="m__bar nodrag">
          <button onClick={copy} title={t("common.copy")} aria-label={t("common.copy")}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {canRegenerate && (
            <button onClick={onRegenerate} title={t("message.regenerate")} aria-label={t("message.regenerate")}>
              <RefreshCcw size={13} />
            </button>
          )}
          {canEdit && (
            <button onClick={() => setEditing((v) => !v)} title={t("message.editResend")} aria-label={t("message.editResend")}>
              <Pencil size={13} />
            </button>
          )}
          {role !== "user" && typeof sourceSeq === "number" && onBranch && (
            <button onClick={() => setBranchOpen(true)} title={t("message.branch")} aria-label={t("message.branch")}>
              <IconSplit size={13} />
            </button>
          )}
          {meta && <span className="m__meta">{meta}</span>}
        </div>
      )}
      {role === "error" && onRetry && (
        <button className="m__retry nodrag" onClick={onRetry}>{t("message.retry")}</button>
      )}
      {role !== "user" && branchOpen && typeof sourceSeq === "number" && onBranch && (
        <MessageBranchDialog
          open={branchOpen}
          onOpenChange={setBranchOpen}
          onSelect={(mode) => onBranch(mode, sourceSeq)}
        />
      )}
    </div>
  );
}, equalMessageProps);
