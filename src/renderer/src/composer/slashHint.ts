const STORAGE_KEY = "loom:composer:slash-hint-dismissed";
const EVENT_NAME = "loom:composer:slash-hint-dismissed";

let cached: boolean | null = null;

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isSlashHintDismissed(): boolean {
  cached ??= readStored();
  return cached;
}

export function dismissSlashHint(): void {
  if (isSlashHintDismissed()) return;
  cached = true;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage 不可用（隐私模式等）时退化为本次会话内隐藏。
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeSlashHint(listener: () => void): () => void {
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
