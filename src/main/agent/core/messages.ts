import type { AgentMessage } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// ① 领域核心 · Loom 业务消息（"材料"）。
//
// pi-ai 的 Message 是 provider 可读的原子；pi-agent-core 的 AgentMessage
// 把它和应用可扩展消息组成 agent 转写。Loom 自有的、不可直接发送给 provider
// 的消息必须在此声明，并由 convertToLlm 明确转换或过滤。
// ---------------------------------------------------------------------------

/** 仅供 Loom 界面/持久化使用的消息；不会进入 provider 上下文。 */
export interface LoomUiMessage {
  role: "loomUi";
  kind: "chip" | "notice" | "timeline";
  content: string;
  timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    loomUi: LoomUiMessage;
  }
}

/** Loom 的完整 agent 转写：pi 标准消息（"分子"）加业务消息（"材料"）。 */
export type LoomAgentMessage = AgentMessage;
