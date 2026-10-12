export type TextFragment = { id: string; text: string; offset: number };
export type PastedDraft = { text: string; fragments: TextFragment[] };

export function isLargePaste(text: string): boolean {
  return text.length >= 1_000 || text.split(/\r\n|\r|\n/).length >= 12;
}

export function fullDraft(draft: PastedDraft): string {
  let offset = 0;
  const parts: string[] = [];
  for (const fragment of draft.fragments) {
    parts.push(draft.text.slice(offset, fragment.offset), fragment.text);
    offset = fragment.offset;
  }
  parts.push(draft.text.slice(offset));
  return parts.join("");
}

function replaceRange(draft: PastedDraft, start: number, end: number, text: string): PastedDraft {
  const delta = text.length - (end - start);
  return {
    text: draft.text.slice(0, start) + text + draft.text.slice(end),
    // Visible-text deletion never implicitly deletes hidden source material.
    fragments: draft.fragments.map((fragment) => ({
      ...fragment,
      offset: fragment.offset <= start ? fragment.offset : fragment.offset >= end ? fragment.offset + delta : start,
    })),
  };
}

export function editVisibleDraft(draft: PastedDraft, text: string): PastedDraft {
  let start = 0;
  while (start < draft.text.length && start < text.length && draft.text[start] === text[start]) start++;
  let end = draft.text.length;
  let nextEnd = text.length;
  while (end > start && nextEnd > start && draft.text[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  return replaceRange(draft, start, end, text.slice(start, nextEnd));
}

export function insertTextFragment(draft: PastedDraft, start: number, end: number, text: string, id: string): PastedDraft {
  const next = replaceRange(draft, start, end, "");
  next.fragments = [...next.fragments, { id, text, offset: start }].sort((a, b) => a.offset - b.offset);
  return next;
}

export function restorePastedDraft(value: string, saved: unknown): PastedDraft {
  const fallback = { text: value, fragments: [] };
  if (!saved || typeof saved !== "object") return fallback;
  const candidate = saved as { version?: unknown; text?: unknown; fragments?: unknown };
  if (candidate.version !== 1 || typeof candidate.text !== "string" || !Array.isArray(candidate.fragments)) return fallback;
  let previousOffset = 0;
  const ids = new Set<string>();
  for (const fragment of candidate.fragments) {
    if (!fragment || typeof fragment.id !== "string" || !fragment.id || ids.has(fragment.id)
      || typeof fragment.text !== "string" || !Number.isInteger(fragment.offset)
      || fragment.offset < previousOffset || fragment.offset > candidate.text.length) return fallback;
    previousOffset = fragment.offset;
    ids.add(fragment.id);
  }
  const draft = { text: candidate.text, fragments: candidate.fragments as TextFragment[] };
  return fullDraft(draft) === value ? draft : fallback;
}
