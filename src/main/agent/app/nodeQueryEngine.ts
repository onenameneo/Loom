import type { LlmEnginePort, NodeQueryRequest, NodeQueryResult, TurnRunContext } from "../ports";
import type { TurnRunner } from "./turnRunner";

/**
 * Owns one node query around an engine call. It intentionally does not know
 * storage, graph context, pi values, or renderer APIs; session supplies those
 * concerns through the request callbacks.
 */
export interface NodeQueryEngine {
  run(request: NodeQueryRequest): Promise<NodeQueryResult>;
  abort(nodeId: string): { ok: boolean };
  invalidate(nodeId: string): { ok: boolean };
  invalidateAll(): void;
  state(nodeId: string): ReturnType<TurnRunner["state"]>;
  setAwaitingApproval: TurnRunner["setAwaitingApproval"];
  setRunning: TurnRunner["setRunning"];
}

export function createNodeQueryEngine(deps: { engine: LlmEnginePort; turns: TurnRunner }): NodeQueryEngine {
  async function run(request: NodeQueryRequest): Promise<NodeQueryResult> {
    const acquired = deps.turns.acquire(request.nodeId, request.operation);
    if (!acquired.ok) return { result: acquired };

    const turn: TurnRunContext = acquired.turn;
    request.onTurnStarted?.(turn);
    let handle: Awaited<ReturnType<LlmEnginePort["ensure"]>> | undefined;
    let from = 0;
    let error: unknown;

    try {
      handle = await deps.engine.ensure(request.nodeId);
      turn.setAbortHandle(handle);
      const invocation = await request.prepare(handle);
      from = invocation.from ?? handle.messages.length;
      if (invocation.kind === "prompt") await handle.prompt(invocation.message);
      else await handle.continue();
    } catch (cause) {
      error = cause;
    } finally {
      // Invalidated queries belong to a removed or superseded node and must
      // never persist a late engine delta. Aborted queries still retain output.
      if (handle && !turn.isStale()) await request.finalize(handle, from);
    }

    return { result: deps.turns.settle(turn, error), error };
  }

  return {
    run,
    abort: (nodeId) => deps.turns.abort(nodeId),
    invalidate: (nodeId) => deps.turns.invalidate(nodeId),
    invalidateAll: () => deps.turns.invalidateAll(),
    state: (nodeId) => deps.turns.state(nodeId),
    setAwaitingApproval: (nodeId, turnId, approval) => deps.turns.setAwaitingApproval(nodeId, turnId, approval),
    setRunning: (nodeId, turnId) => deps.turns.setRunning(nodeId, turnId),
  };
}
