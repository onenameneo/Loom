export type DefaultTitleState = "default" | "manual";

export const DEFAULT_SESSION_TITLE = "新会话";
export const DEFAULT_ROOT_TITLE = "起点";
export const DEFAULT_BRANCH_TITLE = "新会话";
export const UNTITLED_SESSION_TITLE = "未命名会话";

const LEGACY_SESSION_DEFAULTS = new Set(["默认会话", "未命名会话", "新会话"]);
const LEGACY_NODE_DEFAULTS = new Set(["主线", "分支", "新分支", "新会话", "起点"]);
const SENTENCE_BOUNDARY = /[。！？!?.\n]/;

export function normalizeGeneratedTitle(
  input: string | undefined | null,
  options: { fallback?: string; maxLength?: number } = {},
): string {
  const fallback = options.fallback ?? UNTITLED_SESSION_TITLE;
  const maxLength = options.maxLength ?? 24;
  const withoutCode = String(input ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  const compact = withoutCode.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  const boundary = compact.search(SENTENCE_BOUNDARY);
  const sentence = boundary > 0 ? compact.slice(0, boundary) : compact;
  const readable = sentence.trim();
  if (!readable) return fallback;
  const chars = Array.from(readable);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : readable;
}

export function isDefaultSessionTitle(title: string | undefined | null): boolean {
  return LEGACY_SESSION_DEFAULTS.has(String(title ?? "").trim());
}

export function isDefaultNodeTitle(title: string | undefined | null): boolean {
  return LEGACY_NODE_DEFAULTS.has(String(title ?? "").trim());
}

export function shouldAutoTitleSession(record: { title: string; titleState?: DefaultTitleState }): boolean {
  return record.titleState === "default" || (!record.titleState && isDefaultSessionTitle(record.title));
}

export function shouldAutoTitleNode(record: { title: string; titleState?: DefaultTitleState }): boolean {
  return record.titleState === "default" || (!record.titleState && isDefaultNodeTitle(record.title));
}

export function branchTitleFromCandidates(input: {
  selectedText?: string | null;
  currentPrompt?: string | null;
  fallback?: string;
}): string {
  const fallback = input.fallback ?? DEFAULT_BRANCH_TITLE;
  const selected = normalizeGeneratedTitle(input.selectedText, { fallback: "" });
  if (selected) return selected;
  const prompt = normalizeGeneratedTitle(input.currentPrompt, { fallback: "" });
  return prompt || fallback;
}
