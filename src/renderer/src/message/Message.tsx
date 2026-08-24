import { memo, useId, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Brain, Check, ChevronDown, ChevronUp, Copy, FileText, FolderOpen, Pencil, RefreshCcw } from "lucide-react";
import type { FileArtifactRef } from "../../../common/fileArtifacts";
import { artifactIdFromLink, artifactLink } from "../../../common/fileArtifacts";
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
import { linkifyArtifactText } from "./fileArtifacts";

export type MsgRole = "user" | "assistant" | "error" | "tool" | "skill" | "checkpoint";
export type Density = "compact" | "comfortable";
type CheckpointInfo = NonNullable<NodeMsg["checkpoint"]>;
const CHECKPOINT_SUMMARY_LIMIT = 4_000;
const ARTIFACT_COLLAPSE_LIMIT = 5;

function artifactForInlineCode(value: string, artifacts: FileArtifactRef[]): FileArtifactRef | undefined {
  const normalized = value.trim().replace(/\\/g, "/");
  const exact = artifacts.find((artifact) => [artifact.name, artifact.displayPath, artifact.project?.path]
    .filter(Boolean)
    .some((candidate) => candidate!.replace(/\\/g, "/") === normalized));
  if (exact) return exact;
  const suffixMatches = artifacts.filter((artifact) => normalized.endsWith(`/${artifact.name}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function renderCode({ className, children }: any, artifacts: FileArtifactRef[] = [], onArtifactOpen?: (id: string) => void) {
  const match = /language-(\w+)/.exec(className || "");
  const raw = String(children ?? "");
  if (match || raw.includes("\n")) {
    return <CodeBlock code={raw.replace(/\n$/, "")} lang={match?.[1]} />;
  }
  const artifact = artifactForInlineCode(raw, artifacts);
  if (!artifact) return <code className="inline-code">{children}</code>;
  return (
    <a
      href={artifactLink(artifact)}
      className="inline-code nodrag"
      onClick={(event) => {
        event.preventDefault();
        onArtifactOpen?.(artifact.id);
      }}
    >
      {children}
    </a>
  );
}

// react-markdown 组件覆盖：围栏代码块 → CodeBlock（高亮/复制），行内 code → token 化，
// 链接 → 新窗口（经主进程 window-open handler 走系统浏览器）。不启用 rehype-raw（转义 HTML）。
const mdComponents = {
  pre: (props: any) => <>{props.children}</>,
  code: (props: any) => renderCode(props),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

function markdownComponents(onArtifactOpen?: (id: string) => void, artifacts: FileArtifactRef[] = []) {
  return {
    ...mdComponents,
    code: (props: any) => renderCode(props, artifacts, onArtifactOpen),
    a: ({ href, children }: any) => {
      const artifactId = artifactIdFromLink(href);
      return (
        <a
          href={href}
          className={artifactId ? "nodrag" : undefined}
          target={artifactId ? undefined : "_blank"}
          rel={artifactId ? undefined : "noreferrer"}
          onClick={artifactId ? (event) => {
            event.preventDefault();
            onArtifactOpen?.(artifactId);
          } : undefined}
        >
          {children}
        </a>
      );
    },
  };
}

function messageUrlTransform(value: string) {
  return artifactIdFromLink(value) ? value : defaultUrlTransform(value);
}

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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents} urlTransform={messageUrlTransform}>
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
  artifacts,
  onArtifactOpen,
}: {
  text: string;
  thinking?: string;
  contentParts?: LiveTurnContentPart[];
  streaming: boolean;
  artifacts?: FileArtifactRef[];
  onArtifactOpen?: (id: string) => void;
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
            <ReactMarkdown
              key={`${part.partId}:block:${index}`}
              remarkPlugins={[remarkGfm]}
              components={markdownComponents(onArtifactOpen, artifacts)}
              urlTransform={messageUrlTransform}
            >
              {linkifyArtifactText(block, artifacts)}
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
  artifacts?: FileArtifactRef[];
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
    previous.artifacts === next.artifacts &&
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
  artifacts,
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
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [expandedArtifacts, setExpandedArtifacts] = useState(false);
  const editFieldId = useId();
  const artifactListId = `${editFieldId}-artifact-list`;
  const collapsibleArtifacts = Boolean(artifacts && artifacts.length > ARTIFACT_COLLAPSE_LIMIT);
  const artifactExpanded = !collapsibleArtifacts || expandedArtifacts;
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

  async function artifactAction(id: string, action: "open" | "reveal" | "preview" = "open") {
    const api = window.api?.artifacts;
    if (!api) return;
    const result = await api.action({ id, action });
    if (!result.ok) setArtifactError(result.message || "无法打开文件。");
    else {
      setArtifactError(null);
      if (action === "preview" && result.preview) {
        window.dispatchEvent(new CustomEvent("loom:preview-file", { detail: result.preview }));
      }
    }
  }

  async function copyArtifactPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setArtifactError(null);
    } catch {
      setArtifactError("无法复制文件路径。");
    }
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
        <>
          <AssistantContent text={text} thinking={thinking} contentParts={contentParts} streaming={streaming} artifacts={artifacts} onArtifactOpen={(id) => void artifactAction(id)} />
          {artifacts && artifacts.length > 0 && (
            <div className="m__artifacts nodrag" aria-label="Generated files">
              <div className="m__artifacts-header">
                <strong>{t("message.generatedFiles")}</strong>
                <span>{artifacts.length}</span>
              </div>
              <div className="m__artifact-list" id={artifactListId} data-expanded={artifactExpanded}>
                {artifacts.map((artifact, index) => (
                  <div className="m__artifact" key={artifact.id} data-status={artifact.status} hidden={collapsibleArtifacts && !artifactExpanded && index >= ARTIFACT_COLLAPSE_LIMIT}>
                    <button className="m__artifact-main nodrag" type="button" onClick={() => void artifactAction(artifact.id)} disabled={artifact.status !== "available"}>
                      <FileText size={16} aria-hidden="true" />
                      <span><strong>{artifact.name}</strong><small>{artifact.project?.path || artifact.displayPath}</small></span>
                    </button>
                    <button type="button" className="m__artifact-action nodrag" aria-label="Reveal file in folder" title="Reveal file in folder" onClick={() => void artifactAction(artifact.id, "reveal")}><FolderOpen size={16} /></button>
                    <button type="button" className="m__artifact-action nodrag" aria-label="Copy file path" title="Copy file path" onClick={() => void copyArtifactPath(artifact.displayPath)}><Copy size={16} /></button>
                  </div>
                ))}
              </div>
              {collapsibleArtifacts && (
                <button
                  type="button"
                  className="m__artifact-toggle nodrag"
                  aria-expanded={artifactExpanded}
                  aria-controls={artifactListId}
                  aria-label={artifactExpanded ? "Collapse generated files" : "Expand generated files"}
                  onClick={() => setExpandedArtifacts((expanded) => !expanded)}
                >
                  <span>{artifactExpanded ? t("message.hideExtraFiles") : t("message.showMoreFiles", { count: artifacts.length - ARTIFACT_COLLAPSE_LIMIT })}</span>
                  {artifactExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
          {artifactError && <div className="m__artifact-error" role="status">{artifactError}</div>}
        </>
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
