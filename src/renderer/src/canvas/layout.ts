import type { Node } from "@xyflow/react";

export type NodeLayout = { x: number; y: number; width: number; height: number };
export type NodePosition = { x: number; y: number };

export type TidyNode = {
  id: string;
  parentId?: string;
  width: number;
  height: number;
};

type TidyOptions = {
  rootX?: number;
  rootY?: number;
  gapX?: number;
  gapY?: number;
};

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

type TidyMetrics = {
  node: TidyNode;
  depth: number;
  height: number;
  children: TidyMetrics[];
};

/**
 * Builds a left-to-right tree layout using each node's real dimensions.
 * The subtree height reserves space for the tallest node and all descendants,
 * so resizing a card cannot make the next sibling overlap it.
 */
export function tidyNodePositions(
  nodes: TidyNode[],
  { rootX = 240, rootY = 48, gapX = 150, gapY = 80 }: TidyOptions = {},
): Record<string, NodePosition> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenById = new Map<string, TidyNode[]>();
  const roots: TidyNode[] = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const children = childrenById.get(node.parentId) ?? [];
      children.push(node);
      childrenById.set(node.parentId, children);
    } else {
      roots.push(node);
    }
  }

  const maxWidthByDepth = new Map<number, number>();
  const measure = (node: TidyNode, depth: number): TidyMetrics => {
    maxWidthByDepth.set(depth, Math.max(maxWidthByDepth.get(depth) ?? 0, node.width));
    const children = (childrenById.get(node.id) ?? []).map((child) => measure(child, depth + 1));
    const childrenHeight = children.reduce((total, child) => total + child.height, 0)
      + Math.max(0, children.length - 1) * gapY;
    return {
      node,
      depth,
      children,
      height: Math.max(node.height, childrenHeight),
    };
  };

  const metrics = roots.map((root) => measure(root, 0));
  const xByDepth = new Map<number, number>();
  let x = rootX;
  for (let depth = 0; maxWidthByDepth.has(depth); depth += 1) {
    xByDepth.set(depth, x);
    x += (maxWidthByDepth.get(depth) ?? 0) + gapX;
  }

  const positions: Record<string, NodePosition> = {};
  const place = (metric: TidyMetrics, top: number) => {
    const childrenHeight = metric.children.reduce((total, child) => total + child.height, 0)
      + Math.max(0, metric.children.length - 1) * gapY;
    let childTop = top + (metric.height - childrenHeight) / 2;
    for (const child of metric.children) {
      place(child, childTop);
      childTop += child.height + gapY;
    }
    positions[metric.node.id] = {
      x: xByDepth.get(metric.depth) ?? rootX,
      y: top + (metric.height - metric.node.height) / 2,
    };
  };

  let top = rootY;
  for (const root of metrics) {
    place(root, top);
    top += root.height + gapY;
  }
  return positions;
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
