import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdownBlocks";

describe("splitMarkdownBlocks", () => {
  it("keeps completed top-level blocks stable while a trailing block grows", () => {
    const blocks = splitMarkdownBlocks("First paragraph\n\n```ts\nconst value = 1;\n```\n\nSecond");
    expect(blocks).toEqual([
      "First paragraph",
      "```ts\nconst value = 1;\n```",
      "Second",
    ]);
  });

  it("does not split blank lines inside fenced code", () => {
    expect(splitMarkdownBlocks("```md\nline one\n\nline two\n```\n\nanswer")).toEqual([
      "```md\nline one\n\nline two\n```",
      "answer",
    ]);
  });
});
