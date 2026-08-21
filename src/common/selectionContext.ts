export const MAX_SELECTION_CONTEXT_NOTES = 12;
export const MAX_SELECTION_CONTEXT_TEXT_CHARS = 6_000;
export const MAX_SELECTION_CONTEXT_ANNOTATION_CHARS = 2_000;
export const MAX_SELECTION_CONTEXT_TOTAL_CHARS = 24_000;

export interface SelectionContextNote {
  id: string;
  text: string;
  annotation: string;
}

export type SelectionContextValidationCode = "invalid" | "too-many" | "too-long" | "too-large";

export interface SelectionContextValidationError {
  code: SelectionContextValidationCode;
  message: string;
}

export type SelectionContextPromptResult =
  | { ok: true; notes: SelectionContextNote[]; text: string }
  | ({ ok: false } & SelectionContextValidationError);

function newId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `selection-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeEntry(value: unknown): SelectionContextNote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SelectionContextNote>;
  const id = stringValue(candidate.id)?.trim();
  const text = stringValue(candidate.text)?.trim();
  if (!id || !text) return undefined;
  const annotation = stringValue(candidate.annotation)?.trim() ?? "";
  return { id, text, annotation };
}

export function createSelectionContextNote(text: string, annotation = "", id = newId()): SelectionContextNote | undefined {
  const normalizedText = text.trim();
  if (!normalizedText) return undefined;
  return { id: id.trim() || newId(), text: normalizedText, annotation: annotation.trim() };
}

export function normalizeSelectionContextNotes(value: unknown): SelectionContextNote[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { selectionNotes?: unknown }).selectionNotes)
      ? (value as { selectionNotes: unknown[] }).selectionNotes
      : [];
  return raw.map(normalizeEntry).filter((entry): entry is SelectionContextNote => Boolean(entry));
}

export function selectionContextMeta(notes: SelectionContextNote[]): { selectionNotes: SelectionContextNote[] } | undefined {
  const normalized = normalizeSelectionContextNotes(notes);
  return normalized.length > 0 ? { selectionNotes: normalized } : undefined;
}

export function selectionContextPrompt(value: unknown): SelectionContextPromptResult {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { selectionNotes?: unknown }).selectionNotes)
      ? (value as { selectionNotes: unknown[] }).selectionNotes
      : [];
  if (raw.some((entry) => !normalizeEntry(entry))) {
    return { ok: false, code: "invalid", message: "选中的文本注释格式无效，请重新添加后重试。" };
  }
  const notes = normalizeSelectionContextNotes(raw);
  if (notes.length === 0) return { ok: true, notes: [], text: "" };
  if (notes.length > MAX_SELECTION_CONTEXT_NOTES) {
    return { ok: false, code: "too-many", message: `最多添加 ${MAX_SELECTION_CONTEXT_NOTES} 条注释。` };
  }

  let totalChars = 0;
  for (const note of notes) {
    if (note.text.length > MAX_SELECTION_CONTEXT_TEXT_CHARS || note.annotation.length > MAX_SELECTION_CONTEXT_ANNOTATION_CHARS) {
      return { ok: false, code: "too-long", message: "选中文本或注释过长，请缩短后重试。" };
    }
    totalChars += note.text.length + note.annotation.length;
  }
  if (totalChars > MAX_SELECTION_CONTEXT_TOTAL_CHARS) {
    return { ok: false, code: "too-large", message: "注释上下文过大，请减少条目或缩短内容。" };
  }

  const text = [
    "<loom-selection-context>",
    ...notes.map((note, index) => [
      `[${index + 1}] 选中文本：`,
      note.text,
      note.annotation ? `注释：${note.annotation}` : "注释：无",
    ].join("\n")),
    "</loom-selection-context>",
  ].join("\n\n");
  return { ok: true, notes, text };
}
