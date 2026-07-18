export const SIDEBAR_STORAGE_KEY = "loom:ui:sidebar-collapsed";

export function readSidebarCollapsed(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "isComposing" | "target">;

export function isBrowserSidebarShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing || event.key !== "\\" || (!event.metaKey && !event.ctrlKey)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest("input, textarea, select, [contenteditable='true']");
}
