import type { EngineHandle, EventSinkPort, TurnLifecycleEvent, TurnOperationKind, TurnResult, TurnRunContext } from "../ports";

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

interface ActiveTurn {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  generation: number;
  state: "running" | "awaiting_approval";
  abortController: AbortController;
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

export function createTurnRunner(deps: { events: EventSinkPort }): TurnRunner {
  const activeByNode = new Map<string, ActiveTurn>();
  const generationByNode = new Map<string, number>();

  function nextGeneration(nodeId: string): number {
    const next = (generationByNode.get(nodeId) ?? 0) + 1;
    generationByNode.set(nodeId, next);
    return next;
  }

  function isStale(active: ActiveTurn): boolean {
    return active.invalidated || generationByNode.get(active.nodeId) !== active.generation;
  }

  function emit(active: ActiveTurn, state: TurnLifecycleEvent["state"], extra?: Partial<TurnLifecycleEvent>) {
    deps.events.emit(active.nodeId, "turn", {
      nodeId: active.nodeId,
      turnId: active.turnId,
      operation: active.operation,
      state,
      ...extra,
    } satisfies TurnLifecycleEvent);
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
    if (activeByNode.has(nodeId)) return { ok: false as const, reason: "node_busy" as const };
    const active: ActiveTurn = {
      nodeId,
      turnId: `turn-${Date.now().toString(36)}-${nextTurnSeq++}`,
      operation,
      generation: nextGeneration(nodeId),
      state: "running",
      abortController: new AbortController(),
      aborted: false,
      invalidated: false,
      settled: false,
    };
    activeByNode.set(nodeId, active);
    emit(active, "running");
    return { ok: true as const, turn: contextFor(active) };
  }

  function settle(turn: TurnRunContext, error?: unknown): TurnResult {
    const active = activeByNode.get(turn.nodeId);
    if (!active || active.turnId !== turn.turnId || active.settled || isStale(active)) {
      if (active?.turnId === turn.turnId) activeByNode.delete(turn.nodeId);
      return { ok: false, reason: "stale" };
    }
    active.settled = true;
    activeByNode.delete(turn.nodeId);
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
    const active = activeByNode.get(nodeId);
    if (!active) return { ok: true };
    active.aborted = true;
    active.abortController.abort();
    active.abortHandle?.abort();
    return { ok: true };
  }

  function invalidate(nodeId: string) {
    const active = activeByNode.get(nodeId);
    nextGeneration(nodeId);
    if (active) {
      active.invalidated = true;
      active.abortController.abort();
      active.abortHandle?.abort();
    }
    return { ok: true };
  }

  function invalidateAll() {
    for (const nodeId of new Set([...generationByNode.keys(), ...activeByNode.keys()])) invalidate(nodeId);
  }

  function state(nodeId: string): TurnLifecycleEvent | undefined {
    const active = activeByNode.get(nodeId);
    return active && !active.settled
      ? { nodeId, turnId: active.turnId, operation: active.operation, state: active.state }
      : undefined;
  }

  function setAwaitingApproval(nodeId: string, turnId: string, approval: NonNullable<TurnLifecycleEvent["approval"]>) {
    const active = activeByNode.get(nodeId);
    return active?.turnId === turnId ? contextFor(active).setAwaitingApproval(approval) : false;
  }

  function setRunning(nodeId: string, turnId: string) {
    const active = activeByNode.get(nodeId);
    return active?.turnId === turnId ? contextFor(active).setRunning() : false;
  }

  return { acquire, settle, abort, invalidate, invalidateAll, state, setAwaitingApproval, setRunning };
}
