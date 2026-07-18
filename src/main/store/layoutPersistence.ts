import { isValidNodeLayout, type NodeLayout, type Store } from "./store";

export type LayoutWriteResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "invalid" | "storage" };

export type LayoutBatchWriteResult =
  | { ok: true; updatedIds: string[] }
  | { ok: false; updatedIds: string[]; reason: "invalid" | "storage" };

export function saveNodeLayout(store: Store, nodeId: string, layout: unknown): LayoutWriteResult {
  if (!nodeId || !isValidNodeLayout(layout)) return { ok: false, reason: "invalid" };
  try {
    return store.updateNodeLayout(nodeId, layout)
      ? { ok: true }
      : { ok: false, reason: "not-found" };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

export function saveNodeLayouts(
  store: Store,
  items: Array<{ id: string; layout: NodeLayout }>,
): LayoutBatchWriteResult {
  const ids = new Set<string>();
  if (
    !Array.isArray(items) ||
    items.some(({ id, layout }) => !id || ids.has(id) || !isValidNodeLayout(layout) || !ids.add(id))
  ) {
    return { ok: false, updatedIds: [], reason: "invalid" };
  }
  try {
    return { ok: true, updatedIds: store.updateNodeLayouts(items) };
  } catch {
    return { ok: false, updatedIds: [], reason: "storage" };
  }
}
