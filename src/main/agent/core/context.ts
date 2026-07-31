import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { CanvasNodeModel, Seed } from "./graph";
import {
  isLoomContextCheckpoint,
  isLoomFrozenBranchSummary,
  type LoomContextCheckpointMessage,
  type LoomFrozenBranchSummaryMessage,
} from "./messages";

// ---------------------------------------------------------------------------
// ① 领域核心 · 分支上下文装配规则（纯 TS，零基础设施依赖）。
//
// pi 的 convertToLlm 接缝把「一个节点自己的消息」交给我们；这里装配已冻结的分支上下文，
// 装配成发给 LLM 的有序序列：
//   [ (可选)祖先链对话 → (可选)seed 片段 → 本节点历史消息（过滤 UI-only） ]
// 纯函数：绝不读取实时祖先链，避免分叉后的父会话改变子会话语义。
// ---------------------------------------------------------------------------

export function roleOf(msg: AgentMessage): string {
  return typeof (msg as any)?.role === "string" ? (msg as any).role : "custom";
}

/** 标准 LLM 消息（可透传给 provider）；UI-only 自定义消息返回 false。 */
export function isLlmMessage(msg: AgentMessage): msg is Message {
  const role = roleOf(msg);
  return role === "user" || role === "assistant" || role === "toolResult";
}

/** 抽取消息里的可读文本（text / thinking 拼接）。 */
export function textOf(msg: AgentMessage): string {
  const content = (msg as any)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => {
      if (c?.type === "text") return c.text ?? "";
      if (c?.type === "thinking") return c.thinking ?? "";
      return "";
    })
    .join("");
}

function userMsg(text: string, now: number): UserMessage {
  return { role: "user", content: text, timestamp: now };
}
/** seed 片段包成一条用户侧上下文消息，注入子节点上下文顶部。 */
export function seedMessage(seed: Seed, now = 0): UserMessage {
  return userMsg(`（上下文）我以下面这段为出发点继续追问：\n「${seed.text}」`, now);
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

export function frozenBranchSummaryMessage(summary: LoomFrozenBranchSummaryMessage, now = 0): UserMessage {
  return userMsg(
    [
      "（冻结祖先摘要）以下是创建此子分支时捕获的不可变祖先上下文摘要。",
      `来源父节点：${summary.source.parentNodeId}`,
      `覆盖范围：${summary.source.fromSeq}..${summary.source.toSeq}`,
      summary.summary,
    ].join("\n"),
    now,
  );
}

/**
 * 装配某节点发往 LLM 的上下文计划：
 *   [ mountAncestors ? 冻结的祖先快照 : ∅ ] + [ seed ? seed 消息 : ∅ ] + own.filter(isLlmMessage)
 * @param now 注入到合成上下文消息的时间戳（默认 0，保持纯净；生产由 ClockPort 提供）。
 */
export function buildContextPlan(
  node: Pick<CanvasNodeModel, "mountAncestors" | "seed"> & { forkContextSnapshot?: Message[]; frozenBranchSummary?: AgentMessage },
  ownMessages: AgentMessage[],
  now = 0,
  tailContext: Message[] = [],
): Message[] {
  const out: Message[] = [];
  if (node.mountAncestors && isLoomFrozenBranchSummary(node.frozenBranchSummary)) {
    out.push(frozenBranchSummaryMessage(node.frozenBranchSummary, now), ...node.frozenBranchSummary.retainedContext);
  } else if (node.mountAncestors && node.forkContextSnapshot) {
    out.push(...node.forkContextSnapshot);
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
  return [
    checkpointContextMessage(checkpoint, now),
    ...ownMessages.filter((msg, index): msg is Message => index > checkpoint.coverage.toSeq && isLlmMessage(msg)),
  ];
}

function newestValidCheckpoint(messages: AgentMessage[]): LoomContextCheckpointMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isLoomContextCheckpoint(msg) && msg.invalidatedAt === undefined) return msg;
  }
  return undefined;
}
