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
export type LayoutPersistenceError = "invalid" | "storage";
export type LayoutPersistenceState = Readonly<{
  status: "idle" | "saving" | "error";
  error: LayoutPersistenceError | null;
}>;

type SessionLayoutQueue = {
  revision: number;
  dirty: Map<string, DirtyLayout>;
  inFlight: boolean;
  persistence: LayoutPersistenceState;
};

export class CanvasLayoutStore {
  private sessions = new Map<string, SessionLayoutQueue>();
  private listeners = new Map<string, Set<() => void>>();

  constructor(private api: LayoutApi) {}

  private queue(sessionId: string): SessionLayoutQueue {
    let queue = this.sessions.get(sessionId);
    if (!queue) {
      queue = {
        revision: 0,
        dirty: new Map(),
        inFlight: false,
        persistence: { status: "idle", error: null },
      };
      this.sessions.set(sessionId, queue);
    }
    return queue;
  }

  enqueue(sessionId: string, nodeId: string, layout: NodeLayout): void {
    const queue = this.queue(sessionId);
    queue.revision += 1;
    queue.dirty.set(nodeId, { revision: queue.revision, layout });
    void this.flush(sessionId);
  }

  enqueueMany(
    sessionId: string,
    items: Array<{ id: string; layout: NodeLayout }>,
  ): void {
    const queue = this.queue(sessionId);
    for (const item of items) {
      queue.revision += 1;
      queue.dirty.set(item.id, { revision: queue.revision, layout: item.layout });
    }
    void this.flush(sessionId);
  }

  getDirty(sessionId: string, nodeId: string): NodeLayout | undefined {
    return this.sessions.get(sessionId)?.dirty.get(nodeId)?.layout;
  }

  getPersistenceState(sessionId: string): LayoutPersistenceState {
    return this.queue(sessionId).persistence;
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    let listeners = this.listeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(sessionId);
    };
  }

  private setPersistenceState(sessionId: string, next: LayoutPersistenceState): void {
    const queue = this.queue(sessionId);
    if (queue.persistence.status === next.status && queue.persistence.error === next.error) return;
    queue.persistence = next;
    for (const listener of this.listeners.get(sessionId) ?? []) listener();
  }

  remove(sessionId: string, nodeIds: string[]): void {
    const queue = this.sessions.get(sessionId);
    if (!queue) return;
    for (const id of nodeIds) queue.dirty.delete(id);
    if (queue.dirty.size === 0 && !queue.inFlight) {
      this.setPersistenceState(sessionId, { status: "idle", error: null });
    }
  }

  retry(sessionId: string): Promise<void> {
    return this.flush(sessionId);
  }

  private async flush(sessionId: string): Promise<void> {
    const queue = this.queue(sessionId);
    if (queue.inFlight || queue.dirty.size === 0) return;
    const snapshot = new Map(queue.dirty);
    const items = [...snapshot].map(([id, value]) => ({ id, layout: value.layout }));
    queue.inFlight = true;
    this.setPersistenceState(sessionId, {
      status: "saving",
      error: queue.persistence.error,
    });
    let result: BatchResult;
    try {
      result = await this.api.updateLayouts(items);
    } catch {
      result = { ok: false, updatedIds: [], reason: "storage" };
    }
    queue.inFlight = false;
    if (!result.ok) {
      this.setPersistenceState(
        sessionId,
        queue.dirty.size > 0
          ? { status: "error", error: result.reason ?? "storage" }
          : { status: "idle", error: null },
      );
      return;
    }

    const updated = new Set(result.updatedIds);
    for (const [id, sent] of snapshot) {
      if (!updated.has(id)) {
        queue.dirty.delete(id);
        continue;
      }
      if (queue.dirty.get(id)?.revision === sent.revision) queue.dirty.delete(id);
    }

    if (queue.dirty.size > 0) {
      await this.flush(sessionId);
      return;
    }
    this.setPersistenceState(sessionId, { status: "idle", error: null });
  }
}
