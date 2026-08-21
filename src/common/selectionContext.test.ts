import { describe, expect, it } from "vitest";
import {
  MAX_SELECTION_CONTEXT_NOTES,
  createSelectionContextNote,
  normalizeSelectionContextNotes,
  selectionContextMeta,
  selectionContextPrompt,
} from "./selectionContext";

describe("selection context notes", () => {
  it("creates a stable entry even when the annotation is empty", () => {
    const note = createSelectionContextNote("  selected text  ", "   ", "note-1");

    expect(note).toEqual({ id: "note-1", text: "selected text", annotation: "" });
    expect(selectionContextMeta([note!])).toEqual({
      selectionNotes: [{ id: "note-1", text: "selected text", annotation: "" }],
    });
  });

  it("normalizes valid metadata and ignores malformed legacy data", () => {
    expect(normalizeSelectionContextNotes({
      selectionNotes: [
        { id: "valid", text: "quoted", annotation: "keep this" },
        { id: 2, text: "bad" },
        { id: "empty", text: "" },
      ],
    })).toEqual([{ id: "valid", text: "quoted", annotation: "keep this" }]);
  });

  it("rejects an over-limit collection before formatting model context", () => {
    const notes = Array.from({ length: MAX_SELECTION_CONTEXT_NOTES + 1 }, (_, index) =>
      createSelectionContextNote(`quote-${index}`, "", `note-${index}`),
    );

    expect(selectionContextPrompt(notes as any)).toMatchObject({
      ok: false,
      code: "too-many",
    });
  });

  it("rejects malformed send payloads instead of silently dropping them", () => {
    expect(selectionContextPrompt([{ id: "missing-text", annotation: "bad" }] as any)).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("rejects entries that exceed the selected text or annotation bounds", () => {
    expect(selectionContextPrompt([{ id: "long-text", text: "x".repeat(6_001), annotation: "" }])).toMatchObject({
      ok: false,
      code: "too-long",
    });
    expect(selectionContextPrompt([{ id: "long-annotation", text: "quote", annotation: "x".repeat(2_001) }])).toMatchObject({
      ok: false,
      code: "too-long",
    });
  });
});
