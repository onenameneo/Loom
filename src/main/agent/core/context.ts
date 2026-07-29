import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { CanvasNodeModel, Seed } from "./graph";

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

/**
 * 装配某节点发往 LLM 的上下文计划：
 *   [ mountAncestors ? 冻结的祖先快照 : ∅ ] + [ seed ? seed 消息 : ∅ ] + own.filter(isLlmMessage)
 * @param now 注入到合成上下文消息的时间戳（默认 0，保持纯净；生产由 ClockPort 提供）。
 */
export function buildContextPlan(
  node: Pick<CanvasNodeModel, "mountAncestors" | "seed"> & { forkContextSnapshot?: Message[] },
  ownMessages: AgentMessage[],
  now = 0,
  tailContext: Message[] = [],
): Message[] {
  const out: Message[] = [];
  if (node.mountAncestors && node.forkContextSnapshot) out.push(...node.forkContextSnapshot);
  if (node.seed) out.push(seedMessage(node.seed, now));
  const ownLlmMessages = ownMessages.filter(isLlmMessage);
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
