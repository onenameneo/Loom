import { describe, expect, it } from "vitest";
import { editVisibleDraft, fullDraft, insertTextFragment, isLargePaste, restorePastedDraft } from "./pastedDraft";

describe("pasted draft projection", () => {
  it("preserves clipboard text at its insertion point through surrounding edits", () => {
    const draft = insertTextFragment({ text: "before AFTER", fragments: [] }, 7, 7, "SOURCE\n", "one");
    expect(draft.text).toBe("before AFTER");
    expect(fullDraft(editVisibleDraft(draft, "longer before AFTER"))).toBe("longer before SOURCE\nAFTER");
    expect(fullDraft(editVisibleDraft(draft, "before answer"))).toBe("before SOURCE\nanswer");
  });
  it("retains hidden fragments when selecting and replacing visible instructions", () => {
    const draft = insertTextFragment({ text: "before after", fragments: [] }, 7, 7, "SOURCE", "one");
    const next = editVisibleDraft(draft, "new instructions");
    expect(next.fragments).toHaveLength(1);
    expect(fullDraft(next)).toContain("SOURCE");
    expect(next.text).toBe("new instructions");
  });
  it("orders multiple pastes at the same cursor and retains subsequent instructions", () => {
    const one = insertTextFragment({ text: "", fragments: [] }, 0, 0, "one\n", "one");
    const two = insertTextFragment(one, 0, 0, "two\n", "two");
    expect(fullDraft(editVisibleDraft(two, "analyze"))).toBe("one\ntwo\nanalyze");
  });
  it("replaces the selected visible text and keeps later fragment offsets valid", () => {
    const one = insertTextFragment({ text: "abc def", fragments: [] }, 4, 4, "TAIL", "one");
    const two = insertTextFragment(one, 0, 3, "HEAD", "two");
    expect(fullDraft(two)).toBe("HEAD TAILdef");
  });
  it("restores only a versioned projection that exactly reconstructs the plain draft", () => {
    const draft = insertTextFragment({ text: "prompt", fragments: [] }, 0, 0, "source", "one");
    expect(restorePastedDraft("sourceprompt", { version: 1, ...draft })).toEqual(draft);
    expect(restorePastedDraft("different", { version: 1, ...draft })).toEqual({ text: "different", fragments: [] });
    expect(restorePastedDraft("sourceprompt", { version: 1, text: "prompt", fragments: [{ id: "one", text: "source", offset: -1 }] }).fragments).toEqual([]);
  });
  it("folds long and multiline paste but leaves short clipboard text inline", () => {
    expect(isLargePaste("x".repeat(1_000))).toBe(true);
    expect(isLargePaste(Array(12).fill("line").join("\r\n"))).toBe(true);
    expect(isLargePaste("short text")).toBe(false);
  });
});
