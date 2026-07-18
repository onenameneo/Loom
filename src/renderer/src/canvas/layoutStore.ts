import type { NodeLayout } from "./layout";

type BatchResult = {
  ok: boolean;
  updatedIds: string[];
  reason?: "invalid" | "storage";
};

export type LayoutApi = {
  updateLayouts: (items: Array<{ id: string; layout: NodeLayout }>) => Promise<BatchResult>;
};

type DirtyLayout = { revision: number; layout: NodeLayout };
type WorkspaceQueue = {
  revision: number;
  dirty: Map<string, DirtyLayout>;
  inFlight: boolean;
};

export class CanvasLayoutStore {
  private workspaces = new Map<string, WorkspaceQueue>();

  constructor(private api: LayoutApi) {}

  private queue(workspaceId: string): WorkspaceQueue {
    let queue = this.workspaces.get(workspaceId);
    if (!queue) {
      queue = { revision: 0, dirty: new Map(), inFlight: false };
      this.workspaces.set(workspaceId, queue);
    }
    return queue;
  }

  enqueue(workspaceId: string, nodeId: string, layout: NodeLayout): void {
    const queue = this.queue(workspaceId);
    queue.revision += 1;
    queue.dirty.set(nodeId, { revision: queue.revision, layout });
    void this.flush(workspaceId);
  }

  enqueueMany(
    workspaceId: string,
    items: Array<{ id: string; layout: NodeLayout }>,
  ): void {
    const queue = this.queue(workspaceId);
    for (const item of items) {
      queue.revision += 1;
      queue.dirty.set(item.id, { revision: queue.revision, layout: item.layout });
    }
    void this.flush(workspaceId);
  }

  getDirty(workspaceId: string, nodeId: string): NodeLayout | undefined {
    return this.workspaces.get(workspaceId)?.dirty.get(nodeId)?.layout;
  }

  remove(workspaceId: string, nodeIds: string[]): void {
    const queue = this.workspaces.get(workspaceId);
    if (!queue) return;
    for (const id of nodeIds) queue.dirty.delete(id);
  }

  retry(workspaceId: string): Promise<void> {
    return this.flush(workspaceId);
  }

  private async flush(workspaceId: string): Promise<void> {
    const queue = this.queue(workspaceId);
    if (queue.inFlight || queue.dirty.size === 0) return;
    const snapshot = new Map(queue.dirty);
    const items = [...snapshot].map(([id, value]) => ({ id, layout: value.layout }));
    queue.inFlight = true;
    let result: BatchResult;
    try {
      result = await this.api.updateLayouts(items);
    } catch {
      result = { ok: false, updatedIds: [], reason: "storage" };
    }
    queue.inFlight = false;
    if (!result.ok) return;

    const updated = new Set(result.updatedIds);
    for (const [id, sent] of snapshot) {
      if (!updated.has(id)) {
        queue.dirty.delete(id);
        continue;
      }
      if (queue.dirty.get(id)?.revision === sent.revision) queue.dirty.delete(id);
    }

    if (queue.dirty.size > 0) await this.flush(workspaceId);
  }
}
