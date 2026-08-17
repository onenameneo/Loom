import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";

export type LoomContextAttachmentKind = "file-context" | "skill-context" | "tool-result-reference";

/** Stable, provider-neutral source identity for a post-compaction attachment. */
export interface LoomContextAttachmentSource {
  identity: string;
  path?: string;
  version?: string;
  toolCallId?: string;
  toolName?: string;
  skillId?: string;
  sourcePath?: string;
  hash?: string;
}

export interface LoomContextAttachment {
  version: 1;
  /** Unknown string kinds are accepted at the persistence boundary for forward compatibility. */
  kind: LoomContextAttachmentKind | (string & {});
  id: string;
  source: LoomContextAttachmentSource;
  text: string;
  tokens: { tokens: number; exact: boolean };
}

export interface LoomContextAttachmentCandidate extends LoomContextAttachment {
  /** Lower values are selected first. Callers should make this recency-aware and deterministic. */
  priority: number;
}

export type AttachmentOmissionReason = "duplicate" | "item-budget" | "aggregate-budget" | "invalid";

export interface AttachmentPlanDiagnostics {
  selectedCount: number;
  omittedCount: number;
  tokens: number;
  source: "exact" | "mixed" | "estimated";
  omissions: { id: string; reason: AttachmentOmissionReason }[];
}

export interface AttachmentPlan {
  attachments: LoomContextAttachment[];
  diagnostics: AttachmentPlanDiagnostics;
}

export interface AttachmentBudget {
  maxTokens: number;
  maxItemTokens?: number;
  tokenCounter?: (attachment: LoomContextAttachmentCandidate) => { tokens: number; exact: boolean };
}

export const DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS = 12_000;
export const DEFAULT_POST_COMPACTION_ATTACHMENT_ITEM_TOKENS = 4_000;

export interface EffectiveSkillAttachmentInput {
  id: string;
  name: string;
  description: string;
  sourceScope: string;
  sourceId: string;
  sourcePath: string;
  hash: string;
  diagnostics?: { level: string; code: string; message: string; path?: string }[];
  enabledEventId?: string;
  current?: unknown;
}

const SUPPORTED_KINDS = new Set<LoomContextAttachmentKind>([
  "file-context",
  "skill-context",
  "tool-result-reference",
]);

export function isSupportedAttachmentKind(kind: unknown): kind is LoomContextAttachmentKind {
  return typeof kind === "string" && SUPPORTED_KINDS.has(kind as LoomContextAttachmentKind);
}

export function planContextAttachments(
  candidates: LoomContextAttachmentCandidate[],
  budget: AttachmentBudget,
): AttachmentPlan {
  const maxTokens = Math.max(0, Math.floor(budget.maxTokens));
  const maxItemTokens = budget.maxItemTokens === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(budget.maxItemTokens));
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const attachments: LoomContextAttachment[] = [];
  const omissions: AttachmentPlanDiagnostics["omissions"] = [];
  let tokensTotal = 0;
  let exact = true;

  for (const candidate of sorted) {
    if (!isValidCandidate(candidate)) {
      omissions.push({ id: candidate.id || "unknown", reason: "invalid" });
      continue;
    }
    const identity = candidate.source.identity || candidate.id;
    if (seen.has(identity)) {
      omissions.push({ id: candidate.id, reason: "duplicate" });
      continue;
    }
    seen.add(identity);
    const candidateTokens = budget.tokenCounter?.(candidate) ?? candidate.tokens;
    if (!isValidTokenDiagnostic(candidateTokens)) {
      omissions.push({ id: candidate.id, reason: "invalid" });
      continue;
    }
    if (candidateTokens.tokens > maxItemTokens) {
      omissions.push({ id: candidate.id, reason: "item-budget" });
      continue;
    }
    if (tokensTotal + candidateTokens.tokens > maxTokens) {
      omissions.push({ id: candidate.id, reason: "aggregate-budget" });
      continue;
    }
    attachments.push({
      version: 1,
      kind: candidate.kind,
      id: candidate.id,
      source: { ...candidate.source },
      text: candidate.text,
      tokens: { ...candidateTokens },
    });
    tokensTotal += candidateTokens.tokens;
    exact = exact && candidateTokens.exact;
  }

  const source = exact ? "exact" : attachments.length === 0 ? "estimated" : "mixed";
  return {
    attachments,
    diagnostics: {
      selectedCount: attachments.length,
      omittedCount: omissions.length,
      tokens: tokensTotal,
      source,
      omissions: omissions.sort((a, b) => omissionRank(a.reason) - omissionRank(b.reason) || a.id.localeCompare(b.id)),
    },
  };
}

/** Convert persisted attachments into synthetic provider-neutral user messages. */
export function attachmentMessages(attachments: LoomContextAttachment[], now = 0): UserMessage[] {
  return attachments
    .filter((attachment) => isSupportedAttachmentKind(attachment.kind) && isValidAttachment(attachment))
    .map((attachment) => ({
      role: "user" as const,
      timestamp: now,
      content: [
        "（上下文 attachment）这是压缩前 transcript 中保留的受限上下文材料；不要把它当作新的用户请求。",
        `类型：${attachment.kind}`,
        `来源：${formatSource(attachment.source)}`,
        attachment.text,
      ].join("\n"),
    }));
}

export function syntheticAttachmentTokenDiagnostic(attachment: LoomContextAttachment): { tokens: number; exact: boolean } {
  const message = attachmentMessages([attachment])[0];
  return {
    tokens: message ? estimateAttachmentTokens(message.content as string) : 0,
    exact: false,
  };
}

export function collectProjectFileAttachmentCandidates(
  messages: AgentMessage[],
  options: { maxChars?: number } = {},
): LoomContextAttachmentCandidate[] {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? 7_500));
  const calls = new Map<string, { name: string; args?: Record<string, unknown> }>();
  const out: LoomContextAttachmentCandidate[] = [];
  for (const message of messages) {
    const anyMessage = message as any;
    if (anyMessage?.role === "assistant" && Array.isArray(anyMessage.toolCalls)) {
      for (const call of anyMessage.toolCalls) {
        if (typeof call?.id === "string" && typeof call?.name === "string") calls.set(call.id, { name: call.name, args: call.args });
      }
    }
  }
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as any;
    if (message?.role !== "toolResult" || message.toolName !== "read" || typeof message.toolCallId !== "string") continue;
    const call = calls.get(message.toolCallId);
    if (!call || call.name !== "read") continue;
    const details = message.details && typeof message.details === "object" ? message.details : undefined;
    const path = normalizeProjectRelativePath(details?.path);
    if (!path) continue;
    const content = messageText(message);
    if (!content) continue;
    const text = content.slice(0, maxChars);
    const version = typeof details?.version === "string" ? details.version : undefined;
    out.push({
      version: 1,
      kind: "file-context",
      id: `file:${path}:${version ?? "unknown"}:${message.toolCallId}`,
      source: { identity: `file:${path}`, path, version, toolCallId: message.toolCallId, toolName: message.toolName },
      text,
      tokens: { tokens: estimateAttachmentTokens(text), exact: false },
      priority: messages.length - index,
    });
  }
  return out;
}

export function collectSkillAttachmentCandidates(skills: EffectiveSkillAttachmentInput[]): LoomContextAttachmentCandidate[] {
  return skills.map((skill, index) => {
    const diagnostics = skill.diagnostics?.map((item) => `${item.code}: ${item.message}`).join("; ");
    const text = [
      `当前有效 skill：${skill.name}（${skill.id}）`,
      `请在需要时使用 skill_read 读取该 skill；不要把本 attachment 当作完整 skill 正文。`,
      `source=${skill.sourceScope}/${skill.sourceId}`, `path=${skill.sourcePath}`, `hash=${skill.hash}`,
      diagnostics ? `诊断=${diagnostics}` : "",
    ].filter(Boolean).join("\n");
    return {
      version: 1,
      kind: "skill-context" as const,
      id: `skill:${skill.id}:${skill.hash}`,
      source: { identity: `skill:${skill.id}`, skillId: skill.id, sourcePath: skill.sourcePath, hash: skill.hash },
      text,
      tokens: { tokens: estimateAttachmentTokens(text), exact: false },
      priority: 100_000 + index,
    };
  });
}

/** The callback must return an existing, validated sidecar path or undefined. */
export function collectToolResultReferenceCandidates(
  messages: AgentMessage[],
  referenceFor: (message: AgentMessage & { role: "toolResult" }) => string | undefined,
): LoomContextAttachmentCandidate[] {
  const out: LoomContextAttachmentCandidate[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as any;
    if (message?.role !== "toolResult" || typeof message.toolCallId !== "string" || typeof message.toolName !== "string") continue;
    const path = referenceFor(message);
    if (typeof path !== "string" || path.length === 0) continue;
    const text = `工具 ${message.toolName} 的完整结果已保存到已验证 sidecar：${path}`;
    out.push({
      version: 1,
      kind: "tool-result-reference",
      id: `tool-result:${message.toolCallId}`,
      source: { identity: `tool-result:${message.toolCallId}`, path, toolCallId: message.toolCallId, toolName: message.toolName },
      text,
      tokens: { tokens: estimateAttachmentTokens(text), exact: false },
      priority: 200_000 + index,
    });
  }
  return out;
}

export function filterAttachmentsCoveredByMessages(
  attachments: LoomContextAttachment[],
  messages: AgentMessage[],
): LoomContextAttachment[] {
  const toolCallIds = new Set<string>();
  const paths = new Set<string>();
  for (const message of messages) {
    const anyMessage = message as any;
    if (typeof anyMessage?.toolCallId === "string") toolCallIds.add(anyMessage.toolCallId);
    for (const call of Array.isArray(anyMessage?.toolCalls) ? anyMessage.toolCalls : []) {
      if (typeof call?.id === "string") toolCallIds.add(call.id);
    }
    const path = normalizeProjectRelativePath(anyMessage?.details?.path);
    if (path) paths.add(path);
  }
  return attachments.filter((attachment) => {
    if (attachment.source.toolCallId && toolCallIds.has(attachment.source.toolCallId)) return false;
    if (attachment.source.path && paths.has(normalizeProjectRelativePath(attachment.source.path) ?? attachment.source.path)) return false;
    return true;
  });
}

function isValidCandidate(candidate: LoomContextAttachmentCandidate): boolean {
  return isValidAttachment(candidate) && Number.isFinite(candidate.priority);
}

function isValidTokenDiagnostic(value: unknown): value is { tokens: number; exact: boolean } {
  return Boolean(
    value && typeof value === "object" &&
    Number.isFinite((value as any).tokens) && (value as any).tokens >= 0 &&
    typeof (value as any).exact === "boolean",
  );
}

function isValidAttachment(attachment: LoomContextAttachment): boolean {
  return attachment.version === 1 && typeof attachment.id === "string" && attachment.id.length > 0 &&
    typeof attachment.kind === "string" && typeof attachment.text === "string" &&
    Boolean(attachment.source && typeof attachment.source.identity === "string" && attachment.source.identity.length > 0) &&
    Boolean(attachment.tokens && Number.isFinite(attachment.tokens.tokens) && attachment.tokens.tokens >= 0 && typeof attachment.tokens.exact === "boolean");
}

function formatSource(source: LoomContextAttachmentSource): string {
  return [source.path, source.sourcePath, source.version, source.toolName, source.toolCallId, source.skillId, source.hash]
    .filter((part): part is string => Boolean(part))
    .join(" | ") || source.identity;
}

function omissionRank(reason: AttachmentOmissionReason): number {
  return reason === "aggregate-budget" ? 0 : reason === "item-budget" ? 1 : reason === "duplicate" ? 2 : 3;
}

function normalizeProjectRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) return undefined;
  return normalized || undefined;
}

function messageText(message: any): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((item: any) => item?.type === "text" ? item.text ?? "" : "").join("");
}

function estimateAttachmentTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}
