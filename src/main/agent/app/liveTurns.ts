import type { TurnLifecycleEvent, TurnOperationKind } from "../ports";
import type {
  LiveTurnContentPart,
  LiveTurnContentPartKind,
  LiveTurnEvent,
  LiveTurnPatch,
  LiveTurnPartPatch,
  LiveTurnSnapshot,
} from "../../../common/liveTurns";

export type {
  LiveTurnContentPart,
  LiveTurnContentPartKind,
  LiveTurnEvent,
  LiveTurnPatch,
  LiveTurnPartPatch,
  LiveTurnSnapshot,
} from "../../../common/liveTurns";

export interface LiveTurnPublisher {
  subscribe(listener: (event: LiveTurnEvent) => void): () => void;
  publish(event: LiveTurnEvent): void;
}

export type LiveTurnPublisherOptions = {
  schedule?: (flush: () => void) => unknown;
};

/**
 * 纯发布器：只广播 live 事件，不持有节点状态。
 * 快照本体与 revision 由 NodeRuntime store 持有/盖章，这里只负责分发到订阅者
 * （renderer workspace bridge 的订阅 + 初始快照顺序由调用方保证）。
 */
export function createLiveTurnPublisher(options: LiveTurnPublisherOptions = {}): LiveTurnPublisher {
  const listeners = new Set<(event: LiveTurnEvent) => void>();
  const pending = new Map<string, LiveTurnPatch>();
  let flushScheduled = false;
  const schedule = options.schedule ?? ((flush: () => void) => setTimeout(flush, 16));
  const emit = (event: LiveTurnEvent) => {
    for (const listener of listeners) listener(event);
  };
  const flush = () => {
    flushScheduled = false;
    for (const event of pending.values()) emit(event);
    pending.clear();
  };
  const queuePatch = (event: LiveTurnPatch) => {
    const key = `${event.nodeId}:${event.turnId}`;
    const previous = pending.get(key);
    if (previous) {
      const parts = [...previous.parts];
      for (const part of event.parts) {
        const last = parts[parts.length - 1];
        if (last?.partId === part.partId && last.kind === part.kind) {
          parts[parts.length - 1] = { ...last, delta: `${last.delta}${part.delta}` };
        } else {
          parts.push(part);
        }
      }
      pending.set(key, {
        ...event,
        sequenceStart: previous.sequenceStart,
        sequenceEnd: event.sequenceEnd,
        sequence: event.sequenceEnd,
        parts,
      });
    } else {
      pending.set(key, event);
    }
    if (!flushScheduled) {
      flushScheduled = true;
      schedule(flush);
    }
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event) {
      if (event.type === "patch") {
        queuePatch(event);
        return;
      }
      flush();
      emit(event);
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
  return { ...input, state: "running", revision: 0, assistantText: "", contentParts: [], contentSequence: 0 };
}

export function appendAssistantDeltaToSnapshot(snapshot: LiveTurnSnapshot, delta: string): LiveTurnSnapshot {
  if (!delta) return snapshot;
  return appendContentDelta(snapshot, "text", delta);
}

export function appendAssistantThinkingToSnapshot(snapshot: LiveTurnSnapshot, delta: string): LiveTurnSnapshot {
  if (!delta) return snapshot;
  return appendContentDelta(snapshot, "thinking", delta);
}

function appendContentDelta(snapshot: LiveTurnSnapshot, kind: LiveTurnContentPartKind, delta: string): LiveTurnSnapshot {
  const sequence = (snapshot.contentSequence ?? 0) + 1;
  const parts = [...(snapshot.contentParts ?? [])];
  const last = parts[parts.length - 1];
  if (last?.kind === kind) {
    parts[parts.length - 1] = { ...last, text: `${last.text}${delta}` };
  } else {
    parts.push({ partId: `${snapshot.turnId}:part:${sequence}`, kind, text: delta, sequence });
  }
  return {
    ...snapshot,
    assistantText: kind === "text" ? `${snapshot.assistantText}${delta}` : snapshot.assistantText,
    assistantThinking: kind === "thinking" ? `${snapshot.assistantThinking ?? ""}${delta}` : snapshot.assistantThinking,
    contentParts: parts,
    contentSequence: sequence,
  };
}

function normalizedParts(snapshot: LiveTurnSnapshot): LiveTurnContentPart[] {
  if (snapshot.contentParts?.length) return snapshot.contentParts;
  const parts: LiveTurnContentPart[] = [];
  if (snapshot.assistantThinking) parts.push({ partId: `${snapshot.turnId}:legacy:thinking`, kind: "thinking", text: snapshot.assistantThinking, sequence: 1 });
  if (snapshot.assistantText) parts.push({ partId: `${snapshot.turnId}:legacy:text`, kind: "text", text: snapshot.assistantText, sequence: parts.length + 1 });
  return parts;
}

function isContinuation(previous: LiveTurnContentPart[], next: LiveTurnContentPart[]): boolean {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (!after || before.partId !== after.partId || before.kind !== after.kind || !after.text.startsWith(before.text)) return false;
  }
  return true;
}

export function createLiveTurnEvent(
  previous: LiveTurnSnapshot | undefined,
  next: LiveTurnSnapshot,
  revision: number,
): LiveTurnEvent {
  const stamped = { ...next, revision };
  if (!previous || previous.turnId !== next.turnId) return { type: "upsert", snapshot: stamped };

  const before = normalizedParts(previous);
  const after = normalizedParts(next);
  if (!isContinuation(before, after)) return { type: "replace", nodeId: next.nodeId, turnId: next.turnId, revision, snapshot: stamped };

  const parts: LiveTurnPartPatch[] = [];
  for (let index = 0; index < after.length; index += 1) {
    const current = after[index];
    const prior = before[index];
    const delta = prior ? current.text.slice(prior.text.length) : current.text;
    if (delta) parts.push({ partId: current.partId, kind: current.kind, delta, sequence: current.sequence });
  }
  return {
    type: "patch",
    nodeId: next.nodeId,
    sessionId: next.sessionId,
    turnId: next.turnId,
    operation: next.operation,
    state: next.state,
    revision,
    sequenceStart: parts.length > 0 ? (previous.contentSequence ?? 0) + 1 : (previous.contentSequence ?? 0),
    sequenceEnd: next.contentSequence ?? revision,
    sequence: next.contentSequence ?? revision,
    parts,
    approval: next.approval,
  };
}

/** 非终态生命周期 → 更新快照；终态（completed/aborted/failed）→ 返回 undefined 以触发移除。 */
export function applyLifecycleToSnapshot(
  snapshot: LiveTurnSnapshot,
  event: TurnLifecycleEvent,
): LiveTurnSnapshot | undefined {
  if (event.state === "completed" || event.state === "aborted" || event.state === "failed") return undefined;
  return { ...snapshot, state: event.state, approval: event.approval };
}
