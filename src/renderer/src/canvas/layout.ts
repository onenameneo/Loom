import type { Node } from "@xyflow/react";

export type NodeLayout = { x: number; y: number; width: number; height: number };
export type NodePosition = { x: number; y: number };

type BranchPlacementOptions = {
  existing: NodeLayout[];
  preferred: NodeLayout;
  gapX: number;
  rowH: number;
  padding?: number;
  maxAttempts?: number;
};

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

function overlaps(a: NodeLayout, b: NodeLayout, padding: number): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

export function findBranchPlacement({
  existing,
  preferred,
  gapX,
  rowH,
  padding = 28,
  maxAttempts = 48,
}: BranchPlacementOptions): NodeLayout {
  const columnStep = preferred.width + gapX;
  const rowOffsets = [0];
  for (let i = 1; i < maxAttempts; i += 1) {
    rowOffsets.push(i * rowH, -i * rowH);
  }

  for (let column = 0; column < maxAttempts; column += 1) {
    for (const rowOffset of rowOffsets) {
      const candidate = {
        ...preferred,
        x: preferred.x + column * columnStep,
        y: preferred.y + rowOffset,
      };
      if (!existing.some((layout) => overlaps(candidate, layout, padding))) {
        return candidate;
      }
    }
  }

  return {
    ...preferred,
    x: preferred.x + columnStep,
    y: preferred.y + existing.length * rowH,
  };
}
