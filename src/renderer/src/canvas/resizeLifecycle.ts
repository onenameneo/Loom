import type { NodeLayout } from "./layout";
import type { ResizeSession } from "./resizeSession";

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
