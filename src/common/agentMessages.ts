import type { SystemPromptLocale } from "./systemPrompt";

export type AgentMessageKey = "apiKeyMissing" | "contextOverflow" | "nodeNotFound";

const MESSAGES: Record<SystemPromptLocale, Record<AgentMessageKey, string>> = {
  "zh-CN": {
    apiKeyMissing: "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。",
    contextOverflow: "上下文仍然超出模型窗口，已停止自动重试。",
    nodeNotFound: "节点不存在。",
  },
  en: {
    apiKeyMissing: "No API key configured. Add one in Settings or set ANTHROPIC_API_KEY.",
    contextOverflow: "The context still exceeds the model window. Automatic retry has been stopped.",
    nodeNotFound: "Node not found.",
  },
};

export function agentMessage(key: AgentMessageKey, locale: SystemPromptLocale = "zh-CN"): string {
  return MESSAGES[locale][key];
}
