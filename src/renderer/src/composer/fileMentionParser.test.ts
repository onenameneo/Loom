import { describe, expect, it } from "vitest";
import { findFileMentionTrigger } from "./fileMentionParser";

describe("file mention parser", () => {
  it("detects a current @ query only at a word boundary", () => {
    expect(findFileMentionTrigger("请看 @src/in", "请看 @src/in".length)).toEqual({ start: 3, end: "请看 @src/in".length, query: "src/in" });
    expect(findFileMentionTrigger("mail@test.com", 13)).toBeNull();
    expect(findFileMentionTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });
});
