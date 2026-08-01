import { describe, expect, it } from "vitest";
import {
  branchTitleFromCandidates,
  isDefaultNodeTitle,
  isDefaultSessionTitle,
  normalizeGeneratedTitle,
  shouldAutoTitleSession,
} from "./titleDefaults";

describe("title default helpers", () => {
  it("normalizes generated titles deterministically", () => {
    expect(normalizeGeneratedTitle("  第一行问题？\n第二行继续  ")).toBe("第一行问题");
    expect(normalizeGeneratedTitle("请解释\n```ts\nconst x = 1\n```\n然后给方案")).toBe("请解释 然后给方案");
    expect(normalizeGeneratedTitle("这是一个非常非常非常非常非常非常长的标题，需要截断")).toBe("这是一个非常非常非常非常非常非常长的标题，需要截…");
  });

  it("detects legacy default titles and manual protection", () => {
    expect(isDefaultSessionTitle("默认会话")).toBe(true);
    expect(isDefaultSessionTitle("新会话")).toBe(true);
    expect(isDefaultNodeTitle("主线")).toBe(true);
    expect(isDefaultNodeTitle("新分支")).toBe(true);
    expect(shouldAutoTitleSession({ title: "新会话", titleState: "manual" })).toBe(false);
    expect(shouldAutoTitleSession({ title: "新会话", titleState: "default" })).toBe(true);
  });

  it("uses selected text, then current prompt, then fallback for branch titles", () => {
    expect(branchTitleFromCandidates({ selectedText: "选中的提问内容", currentPrompt: "当前问题" })).toBe("选中的提问内容");
    expect(branchTitleFromCandidates({ selectedText: "```ts\nx\n```", currentPrompt: "当前问题" })).toBe("当前问题");
    expect(branchTitleFromCandidates({ selectedText: "", currentPrompt: "" })).toBe("新会话");
  });
});
