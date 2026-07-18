import type { NodeLayout } from "./layout";
import type { ResizeSession } from "./resizeSession";
import type { Node, NodeChange } from "@xyflow/react";

type FinishResizeOptions = {
  session: ResizeSession;
  token: number;
  nodeId: string;
  layout: NodeLayout;
  apply: (nodeId: string, layout: NodeLayout) => void;
  enqueue: (nodeId: string, layout: NodeLayout) => void;
};

export function finishResizeInteraction({
  session,
  token,
  nodeId,
  layout,
  apply,
  enqueue,
}: FinishResizeOptions): NodeLayout | null {
  const finalLayout = session.finish(token, nodeId, layout);
  if (!finalLayout) return null;

  apply(nodeId, finalLayout);
  enqueue(nodeId, finalLayout);
  return finalLayout;
}

export function guardResizeNodeChanges<NodeType extends Node>(
  changes: NodeChange<NodeType>[],
  session: ResizeSession,
): NodeChange<NodeType>[] {
  return changes.map((change) => {
    if (
      change.type !== "dimensions" ||
      typeof change.resizing !== "boolean" ||
      session.isActiveFor(change.id)
    ) {
      return change;
    }

    const canonical = session.canonicalLayout(change.id);
    return {
      ...change,
      resizing: false,
      dimensions: canonical
        ? { width: canonical.width, height: canonical.height }
        : change.dimensions,
    };
  });
}
