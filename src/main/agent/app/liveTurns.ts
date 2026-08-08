import type { TurnLifecycleEvent, TurnOperationKind } from "../ports";

export type LiveTurnSnapshot = {
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: Extract<TurnLifecycleEvent["state"], "running" | "awaiting_approval">;
  revision: number;
  assistantText: string;
  approval?: TurnLifecycleEvent["approval"];
};

export type LiveTurnEvent =
  | { type: "upsert"; snapshot: LiveTurnSnapshot }
  | { type: "remove"; nodeId: string; revision: number };

export function createLiveTurnStore() {
  const turns = new Map<string, LiveTurnSnapshot>();
  const revisions = new Map<string, number>();
  const listeners = new Set<(event: LiveTurnEvent) => void>();

  const nextRevision = (nodeId: string) => {
    const next = (revisions.get(nodeId) ?? 0) + 1;
    revisions.set(nodeId, next);
    return next;
  };
  const publish = (event: LiveTurnEvent) => {
    for (const listener of listeners) listener(event);
  };
  const replace = (nodeId: string, patch: Partial<Omit<LiveTurnSnapshot, "nodeId" | "revision">>) => {
    const current = turns.get(nodeId);
    if (!current) return undefined;
    const snapshot = { ...current, ...patch, revision: nextRevision(nodeId) };
    turns.set(nodeId, snapshot);
    publish({ type: "upsert", snapshot });
    return snapshot;
  };

  return {
    beginTurn(input: Omit<LiveTurnSnapshot, "state" | "revision" | "assistantText" | "approval">) {
      const snapshot: LiveTurnSnapshot = {
        ...input,
        state: "running",
        assistantText: "",
        revision: nextRevision(input.nodeId),
      };
      turns.set(input.nodeId, snapshot);
      publish({ type: "upsert", snapshot });
      return snapshot;
    },
    applyLifecycle(nodeId: string, event: TurnLifecycleEvent) {
      if (event.state === "completed" || event.state === "aborted" || event.state === "failed") return invalidateNode(nodeId);
      return replace(nodeId, { state: event.state, approval: event.approval });
    },
    appendAssistantDelta(nodeId: string, delta: string) {
      const current = turns.get(nodeId);
      return current ? replace(nodeId, { assistantText: `${current.assistantText}${delta}` }) : undefined;
    },
    invalidateNode,
    list: () => [...turns.values()],
    get: (nodeId: string) => turns.get(nodeId),
    subscribe(listener: (event: LiveTurnEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function invalidateNode(nodeId: string): LiveTurnEvent | undefined {
    if (!turns.delete(nodeId)) return undefined;
    const event: LiveTurnEvent = { type: "remove", nodeId, revision: nextRevision(nodeId) };
    publish(event);
    return event;
  }
}
