import type { SystemPromptLocale } from "./systemPrompt";

export type AgentMessageKey = "apiKeyMissing" | "contextOverflow" | "nodeNotFound";

const MESSAGES: Record<SystemPromptLocale, Record<AgentMessageKey, string>> = {
  "zh-CN": {
    apiKeyMissing: "未配置 API key（请在设置中添加 Provider 和模型凭证）。",
    contextOverflow: "上下文仍然超出模型窗口，已停止自动重试。",
    nodeNotFound: "节点不存在。",
  },
  en: {
    apiKeyMissing: "No API key configured. Add a provider and model credential in Settings.",
    contextOverflow: "The context still exceeds the model window. Automatic retry has been stopped.",
    nodeNotFound: "Node not found.",
  },
};

export function agentMessage(key: AgentMessageKey, locale: SystemPromptLocale = "zh-CN"): string {
  return MESSAGES[locale][key];
}
