import type { Node } from "@xyflow/react";

export type NodeLayout = { x: number; y: number; width: number; height: number };
export type NodePosition = { x: number; y: number };

export function resolveNodeLayout(
  dto: { layout?: NodeLayout },
  fallback: NodeLayout,
  dirty?: NodeLayout,
): NodeLayout {
  return dirty ?? dto.layout ?? fallback;
}

export function applyTidyPositions<T extends Node>(
  nodes: T[],
  positions: Record<string, NodePosition>,
): T[] {
  return nodes.map((node) => ({
    ...node,
    position: positions[node.id] ?? node.position,
  }));
}

export function reconcileExistingNode<T extends Node>(
  existing: T,
  data: Record<string, unknown>,
): T {
  return {
    ...existing,
    data: { ...existing.data, ...data },
  };
}

export function readNodeLayout(node: Node): NodeLayout {
  const width = typeof node.style?.width === "number" ? node.style.width : 360;
  const height = typeof node.style?.height === "number" ? node.style.height : 440;
  return { x: node.position.x, y: node.position.y, width, height };
}
