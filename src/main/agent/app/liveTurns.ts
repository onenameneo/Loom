import type { TurnLifecycleEvent, TurnOperationKind } from "../ports";

export type LiveTurnSnapshot = {
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: Extract<TurnLifecycleEvent["state"], "running" | "awaiting_approval">;
  revision: number;
  assistantText: string;
  assistantThinking?: string;
  approval?: TurnLifecycleEvent["approval"];
};

export type LiveTurnEvent =
  | { type: "upsert"; snapshot: LiveTurnSnapshot }
  | { type: "remove"; nodeId: string; revision: number };

export interface LiveTurnPublisher {
  subscribe(listener: (event: LiveTurnEvent) => void): () => void;
  publish(event: LiveTurnEvent): void;
}

/**
 * 纯发布器：只广播 live 事件，不持有节点状态。
 * 快照本体与 revision 由 NodeRuntime store 持有/盖章，这里只负责分发到订阅者
 * （renderer workspace bridge 的订阅 + 初始快照顺序由调用方保证）。
 */
export function createLiveTurnPublisher(): LiveTurnPublisher {
  const listeners = new Set<(event: LiveTurnEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

// ---- 纯快照变换（供 session 经 NodeRuntime.transition 计算并写入）----

/** 一个 turn 开始的快照；revision 由 store 在发布时盖章。 */
export function beginTurnSnapshot(input: {
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: TurnOperationKind;
}): LiveTurnSnapshot {
  return { ...input, state: "running", revision: 0, assistantText: "" };
}

export function appendAssistantDeltaToSnapshot(snapshot: LiveTurnSnapshot, delta: string): LiveTurnSnapshot {
  return { ...snapshot, assistantText: `${snapshot.assistantText}${delta}` };
}

export function appendAssistantThinkingToSnapshot(snapshot: LiveTurnSnapshot, delta: string): LiveTurnSnapshot {
  return { ...snapshot, assistantThinking: `${snapshot.assistantThinking ?? ""}${delta}` };
}

/** 非终态生命周期 → 更新快照；终态（completed/aborted/failed）→ 返回 undefined 以触发移除。 */
export function applyLifecycleToSnapshot(
  snapshot: LiveTurnSnapshot,
  event: TurnLifecycleEvent,
): LiveTurnSnapshot | undefined {
  if (event.state === "completed" || event.state === "aborted" || event.state === "failed") return undefined;
  return { ...snapshot, state: event.state, approval: event.approval };
}
