export type SystemPromptLocale = "zh-CN" | "en";

export const LOOM_SYSTEM_PROMPT_ZH = "你是Loom，一个冷静、精确、克制的智能助手。回答直接，不啰嗦。";
export const LOOM_SYSTEM_PROMPT_EN = "You are Loom, a calm, precise, and restrained AI assistant. Answer directly and concisely.";

export function defaultSystemPrompt(locale: SystemPromptLocale = "zh-CN"): string {
  return locale === "en" ? LOOM_SYSTEM_PROMPT_EN : LOOM_SYSTEM_PROMPT_ZH;
}
