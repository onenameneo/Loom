import { describe, expect, it } from "vitest";
import { isFileMentionPath, normalizeFileMentionPath } from "./fileMentions";

describe("file mention contracts", () => {
  it("normalizes separators and rejects traversal paths", () => {
    expect(normalizeFileMentionPath("./src\\index.ts")).toBe("src/index.ts");
    expect(isFileMentionPath("src/index.ts")).toBe(true);
    expect(isFileMentionPath("../secrets.txt")).toBe(false);
    expect(isFileMentionPath("/absolute/path.ts")).toBe(false);
  });
});
