import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { CanvasNodeModel, Seed } from "./graph";

// ---------------------------------------------------------------------------
// ① 领域核心 · 分支上下文装配规则（纯 TS，零基础设施依赖）。
//
// pi 的 convertToLlm 接缝把「一个节点自己的消息」交给我们；这里现取图上下文，
// 装配成发给 LLM 的有序序列：
//   [ (可选)祖先链对话 → (可选)seed 片段 → 本节点历史消息（过滤 UI-only） ]
// 纯函数：祖先链由 ② 预先解析后传入，不在此摸运行时缓存。
// ---------------------------------------------------------------------------

/** 发给 provider 的最小消息（只认 role + content）。 */
export type LlmMessage = { role: string; content: unknown; timestamp: number };

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

function userMsg(text: string, now: number): LlmMessage {
  return { role: "user", content: text, timestamp: now };
}
function asstMsg(text: string, now: number): LlmMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: now };
}

/** 祖先链的对话消息（按 root→父 顺序，user/assistant 交替，空文本跳过）。 */
export function ancestorMessages(ancestors: CanvasNodeModel[], now = 0): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const n of ancestors) {
    for (const m of n.messages) {
      const text = textOf(m);
      if (!text) continue;
      if (roleOf(m) === "assistant") out.push(asstMsg(text, now));
      else if (roleOf(m) === "user") out.push(userMsg(text, now));
    }
  }
  return out;
}

/** seed 片段包成一条用户侧上下文消息，注入子节点上下文顶部。 */
export function seedMessage(seed: Seed, now = 0): LlmMessage {
  return userMsg(`（上下文）我以下面这段为出发点继续追问：\n「${seed.text}」`, now);
}

/**
 * 装配某节点发往 LLM 的上下文计划：
 *   [ mountAncestors ? 祖先对话 : ∅ ] + [ seed ? seed 消息 : ∅ ] + own.filter(isLlmMessage)
 * @param ancestors 已由 ② 解析好的 root→父 祖先链（node.mountAncestors 决定是否使用）。
 * @param now 注入到合成上下文消息的时间戳（默认 0，保持纯净；生产由 ClockPort 提供）。
 */
export function buildContextPlan(
  node: Pick<CanvasNodeModel, "mountAncestors" | "seed">,
  ownMessages: AgentMessage[],
  ancestors: CanvasNodeModel[],
  now = 0,
): LlmMessage[] {
  const out: LlmMessage[] = [];
  if (node.mountAncestors) out.push(...ancestorMessages(ancestors, now));
  if (node.seed) out.push(seedMessage(node.seed, now));
  out.push(...(ownMessages.filter(isLlmMessage) as unknown as LlmMessage[]));
  return out;
}
