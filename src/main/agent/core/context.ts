import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { CanvasNodeModel, Seed } from "./graph";
import {
  DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
  DEFAULT_POST_COMPACTION_ATTACHMENT_ITEM_TOKENS,
  attachmentMessages,
  filterAttachmentsCoveredByMessages,
  isSupportedAttachmentKind,
  planContextAttachments,
  syntheticAttachmentTokenDiagnostic,
} from "./attachments";
import {
  isLoomContextCheckpoint,
  type LoomContextCheckpointMessage,
} from "./messages";

// ---------------------------------------------------------------------------
// ① 领域核心 · 分支上下文装配规则（纯 TS，零基础设施依赖）。
//
// pi 的 convertToLlm 接缝把「一个节点自己的消息」交给我们；这里装配已冻结的分支上下文，
// 装配成发给 LLM 的有序序列：
//   [ frozenContext → (可选)seed 片段 → 本节点 checkpoint 投影 ]
// 纯函数：绝不读取实时父/祖先节点，避免分叉后的父会话改变子会话语义。
// ---------------------------------------------------------------------------

export function roleOf(msg: AgentMessage): string {
  return typeof (msg as any)?.role === "string" ? (msg as any).role : "custom";
}

/** 标准 LLM 消息（可透传给 provider）；UI-only 自定义消息返回 false。 */
export function isLlmMessage(msg: AgentMessage): msg is Message {
  const role = roleOf(msg);
  return role === "user" || role === "assistant" || role === "toolResult";
}

/** 抽取消息里的可见文本（不包含 thinking）。 */
export function textOf(msg: AgentMessage): string {
  const content = (msg as any)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => {
      if (c?.type === "text") return c.text ?? "";
      return "";
    })
    .join("");
}

/** 抽取 assistant thinking，用于 UI 展示；LLM 上下文仍保留原始 content blocks。 */
export function thinkingOf(msg: AgentMessage): string {
  const content = (msg as any)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => (c?.type === "thinking" ? c.thinking ?? "" : ""))
    .join("");
}

function userMsg(text: string, now: number): UserMessage {
  return { role: "user", content: text, timestamp: now };
}
/** 版本化的、子节点自有的父级上下文快照。 */
export interface FrozenNodeContext {
  version: 1;
  messages: Message[];
}

/** seed 片段仅是背景和分叉定位，不是假装成一条待回答的追问。 */
export function seedMessage(seed: Seed, now = 0): UserMessage {
  return userMsg(`（分叉定位背景）用户从下列片段创建了一个新话题。仅将其作为背景；等待该话题中的下一条用户输入后再响应。\n「${seed.text}」`, now);
}

export function checkpointContextMessage(checkpoint: LoomContextCheckpointMessage, now = 0): UserMessage {
  return userMsg(
    [
      "（上下文 checkpoint）以下是本节点较早对话的结构化摘要。原始 transcript 仍保留，当前请求只投影摘要和未覆盖的最近消息。",
      `触发原因：${checkpoint.reason}`,
      `覆盖范围：${checkpoint.coverage.fromSeq}..${checkpoint.coverage.toSeq}`,
      checkpoint.summary,
    ].join("\n"),
    now,
  );
}

export function checkpointAttachmentMessages(checkpoint: LoomContextCheckpointMessage, uncoveredMessages: AgentMessage[] = [], now = 0): Message[] {
  if (!checkpoint.attachments || checkpoint.attachments.length === 0) return [];
  const candidates = filterAttachmentsCoveredByMessages(checkpoint.attachments, uncoveredMessages)
    .filter((attachment) => isSupportedAttachmentKind(attachment.kind))
    .map((attachment, index) => ({ ...attachment, priority: index }));
  const plan = planContextAttachments(candidates, {
    maxTokens: DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
    maxItemTokens: DEFAULT_POST_COMPACTION_ATTACHMENT_ITEM_TOKENS,
    tokenCounter: syntheticAttachmentTokenDiagnostic,
  });
  return attachmentMessages(plan.attachments, now);
}

/**
 * 装配某节点发往 LLM 的上下文计划：
 *   [ frozenContext ? 冻结快照 : ∅ ] + [ seed ? seed 消息 : ∅ ] + checkpoint 投影
 * @param now 注入到合成上下文消息的时间戳（默认 0，保持纯净；生产由 ClockPort 提供）。
 */
export function buildContextPlan(
  node: Pick<CanvasNodeModel, "seed"> & {
    frozenContext?: FrozenNodeContext;
  },
  ownMessages: AgentMessage[],
  now = 0,
  tailContext: Message[] = [],
): Message[] {
  const out: Message[] = [];
  if (node.frozenContext?.version === 1) {
    out.push(...node.frozenContext.messages);
  }
  if (node.seed) out.push(seedMessage(node.seed, now));
  const ownLlmMessages = projectOwnMessages(ownMessages, now);
  if (tailContext.length > 0 && ownLlmMessages.length > 0 && roleOf(ownLlmMessages[ownLlmMessages.length - 1] as AgentMessage) === "user") {
    out.push(...ownLlmMessages.slice(0, -1));
    out.push(...tailContext);
    out.push(ownLlmMessages[ownLlmMessages.length - 1]!);
  } else {
    out.push(...ownLlmMessages);
    if (ownLlmMessages.length === 0) out.push(...tailContext);
  }
  return out;
}

function projectOwnMessages(ownMessages: AgentMessage[], now: number): Message[] {
  const checkpoint = newestValidCheckpoint(ownMessages);
  if (!checkpoint) return ownMessages.filter(isLlmMessage);
  const uncovered = ownMessages.filter((msg, index): msg is Message => index > checkpoint.coverage.toSeq && isLlmMessage(msg));
  return [
    checkpointContextMessage(checkpoint, now),
    ...checkpointAttachmentMessages(checkpoint, uncovered, now),
    ...uncovered,
  ];
}

function newestValidCheckpoint(messages: AgentMessage[]): LoomContextCheckpointMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isLoomContextCheckpoint(msg) && msg.invalidatedAt === undefined) return msg;
  }
  return undefined;
}
