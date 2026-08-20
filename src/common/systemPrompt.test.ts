import { describe, expect, it } from "vitest";
import { defaultSystemPrompt } from "./systemPrompt";

describe("default system prompt", () => {
  it("uses the Loom Chinese prompt by default", () => {
    expect(defaultSystemPrompt()).toBe("你是Loom，一个冷静、精确、克制的智能助手。回答直接，不啰嗦。");
    expect(defaultSystemPrompt("zh-CN")).toBe("你是Loom，一个冷静、精确、克制的智能助手。回答直接，不啰嗦。");
  });

  it("uses the English translation for the English locale", () => {
    expect(defaultSystemPrompt("en")).toBe("You are Loom, a calm, precise, and restrained AI assistant. Answer directly and concisely.");
  });
});
