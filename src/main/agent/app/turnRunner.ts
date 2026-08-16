import type { AgentTelemetryPort, EngineHandle, EventSinkPort, TurnLifecycleEvent, TurnOperationKind, TurnResult, TurnRunContext } from "../ports";
import type { NodeRuntimeStore } from "./nodeRuntime";

export interface TurnRunner {
  acquire(nodeId: string, operation: TurnOperationKind): { ok: true; turn: TurnRunContext } | { ok: false; reason: "node_busy" };
  settle(turn: TurnRunContext, error?: unknown): TurnResult;
  abort(nodeId: string): { ok: boolean };
  invalidate(nodeId: string): { ok: boolean };
  invalidateAll(): void;
  state(nodeId: string): TurnLifecycleEvent | undefined;
  setAwaitingApproval(nodeId: string, turnId: string, approval: NonNullable<TurnLifecycleEvent["approval"]>): boolean;
  setRunning(nodeId: string, turnId: string): boolean;
}

export interface ActiveTurn {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  generation: number;
  state: "running" | "awaiting_approval";
  abortController: AbortController;
  startedAt: number;
  abortHandle?: Pick<EngineHandle, "abort">;
  aborted: boolean;
  invalidated: boolean;
  settled: boolean;
}

let nextTurnSeq = 1;

function boundedError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

/**
 * turn 状态机：不再自持 `activeByNode` / `generationByNode` Map。
 * per-node 状态（activeTurn / generation）存于 NodeRuntime 记录；generation bump 的
 * stale+abort 副作用由 `NodeRuntime.transition` 统一承担。本模块只表达状态机规则。
 */
export function createTurnRunner(deps: { events: EventSinkPort; telemetry?: AgentTelemetryPort; runtime: NodeRuntimeStore; now?: () => number }): TurnRunner {
  const now = deps.now ?? Date.now;
  function isStale(active: ActiveTurn): boolean {
    const rec = deps.runtime.get(active.nodeId);
    return !rec || rec.disposed || rec.generation !== active.generation;
  }

  const terminalStatus = { completed: "ok", failed: "error", aborted: "aborted" } as const;

  function emit(active: ActiveTurn, state: TurnLifecycleEvent["state"], extra?: Partial<TurnLifecycleEvent>) {
    deps.events.emit(active.nodeId, "turn", {
      nodeId: active.nodeId,
      turnId: active.turnId,
      operation: active.operation,
      state,
      ...extra,
    } satisfies TurnLifecycleEvent);
    if (state === "completed" || state === "aborted" || state === "failed") {
      deps.telemetry?.emit({
        type: "turn_end",
        nodeId: active.nodeId,
        turnId: active.turnId,
        operation: active.operation,
        status: terminalStatus[state],
        at: now(),
        durationMs: Math.max(0, now() - active.startedAt),
        ...(extra?.error ? { error: extra.error } : {}),
      });
    }
  }

  function contextFor(active: ActiveTurn): TurnRunContext {
    return {
      nodeId: active.nodeId,
      turnId: active.turnId,
      operation: active.operation,
      signal: active.abortController.signal,
      setAbortHandle(handle) {
        active.abortHandle = handle;
        if (active.aborted) handle?.abort();
      },
      setAwaitingApproval(approval) {
        if (isStale(active) || active.aborted || active.settled) return false;
        active.state = "awaiting_approval";
        emit(active, "awaiting_approval", approval ? { approval } : undefined);
        return true;
      },
      setRunning() {
        if (isStale(active) || active.aborted || active.settled) return false;
        active.state = "running";
        emit(active, "running");
        return true;
      },
      isStale: () => isStale(active),
    };
  }

  function acquire(nodeId: string, operation: TurnOperationKind) {
    const rec = deps.runtime.get(nodeId);
    if (!rec || rec.activeTurn) return { ok: false as const, reason: "node_busy" as const };
    const generation = (rec.generation ?? 0) + 1;
    const active: ActiveTurn = {
      nodeId,
      turnId: `turn-${Date.now().toString(36)}-${nextTurnSeq++}`,
      operation,
      generation,
      state: "running",
      abortController: new AbortController(),
      startedAt: now(),
      aborted: false,
      invalidated: false,
      settled: false,
    };
    deps.runtime.transition(nodeId, () => ({ activeTurn: active, generation }));
    deps.telemetry?.emit({ type: "turn_start", nodeId, turnId: active.turnId, operation, at: active.startedAt });
    emit(active, "running");
    return { ok: true as const, turn: contextFor(active) };
  }

  function settle(turn: TurnRunContext, error?: unknown): TurnResult {
    const rec = deps.runtime.get(turn.nodeId);
    const active = rec?.activeTurn;
    if (!active || active.turnId !== turn.turnId || active.settled || isStale(active)) {
      if (active?.turnId === turn.turnId) deps.runtime.transition(turn.nodeId, () => ({ activeTurn: undefined }));
      if (active?.turnId === turn.turnId && rec?.disposed) deps.runtime.delete(turn.nodeId);
      return { ok: false, reason: "stale" };
    }
    active.settled = true;
    deps.runtime.transition(turn.nodeId, () => ({ activeTurn: undefined }));
    if (rec.disposed) deps.runtime.delete(turn.nodeId);
    if (active.aborted || active.abortController.signal.aborted) {
      emit(active, "aborted");
      return { ok: false, reason: "aborted" };
    }
    if (error !== undefined) {
      emit(active, "failed", { error: boundedError(error) });
      return { ok: false, reason: "failed" };
    }
    emit(active, "completed");
    return { ok: true, turnId: active.turnId };
  }

  function abort(nodeId: string) {
    const active = deps.runtime.get(nodeId)?.activeTurn;
    if (!active) return { ok: true };
    active.aborted = true;
    active.abortController.abort();
    active.abortHandle?.abort();
    return { ok: true };
  }

  function invalidate(nodeId: string) {
    const rec = deps.runtime.get(nodeId);
    if (!rec) return { ok: true };
    deps.runtime.transition(nodeId, (r) => ({ generation: (r.generation ?? 0) + 1 }));
    return { ok: true };
  }

  function invalidateAll() {
    for (const nodeId of deps.runtime.keys()) invalidate(nodeId);
  }

  function state(nodeId: string): TurnLifecycleEvent | undefined {
    const active = deps.runtime.get(nodeId)?.activeTurn;
    return active && !active.settled
      ? { nodeId, turnId: active.turnId, operation: active.operation, state: active.state }
      : undefined;
  }

  function setAwaitingApproval(nodeId: string, turnId: string, approval: NonNullable<TurnLifecycleEvent["approval"]>) {
    const active = deps.runtime.get(nodeId)?.activeTurn;
    return active?.turnId === turnId ? contextFor(active).setAwaitingApproval(approval) : false;
  }

  function setRunning(nodeId: string, turnId: string) {
    const active = deps.runtime.get(nodeId)?.activeTurn;
    return active?.turnId === turnId ? contextFor(active).setRunning() : false;
  }

  return { acquire, settle, abort, invalidate, invalidateAll, state, setAwaitingApproval, setRunning };
}
