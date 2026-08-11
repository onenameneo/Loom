import type { EngineCacheEntry } from "../ports";
import type { ToolResultBudgetState } from "../core/toolResultBudget";
import type { LiveTurnEvent, LiveTurnSnapshot } from "./liveTurns";
import type { CanvasNode } from "./session";
import type { ActiveTurn } from "./turnRunner";

/**
 * 每节点可变的运行期状态——主进程唯一 per-node 状态。
 * `node` / `pendingSkillIds` / `liveSnapshot` / `manualCompact` 一期收敛；
 * `activeTurn` / `generation` / `engine` / `disposed` 二期接管 turn 生命周期后填充。
 */
export interface NodeRuntime {
  node: CanvasNode;
  pendingSkillIds: string[];
  liveSnapshot?: LiveTurnSnapshot;
  manualCompact?: AbortController;
  /** 当前活跃 turn（turnRunner 写入）。 */
  activeTurn?: ActiveTurn;
  /** 节点当前 epoch；stale 判定源 = `generation === activeTurn.generation`。 */
  generation?: number;
  /** 引擎缓存条目（session 持有；piEngine 不再自持缓存）。 */
  engine?: EngineCacheEntry;
  /** 模型上下文投影用的 tool result replacement 决策状态。 */
  toolResultBudget?: ToolResultBudgetState;
  /** tombstone：dispose/删除后拒绝后续 transition，等 in-flight turn settle 后清理。 */
  disposed?: boolean;
}

export interface NodeRuntimeStore {
  get(nodeId: string): NodeRuntime | undefined;
  has(nodeId: string): boolean;
  entries(): IterableIterator<[string, NodeRuntime]>;
  keys(): IterableIterator<string>;
  nodes(): IterableIterator<CanvasNode>;
  set(nodeId: string, record: NodeRuntime): void;
  delete(nodeId: string): boolean;
  /** 替换 node 对象引用（仅供无活跃 turn 的 hydrate 刷新使用；transition 禁止替换）。 */
  replaceNode(nodeId: string, node: CanvasNode): void;
  /** tombstone：拒绝后续 transition。 */
  markDisposed(nodeId: string): void;
  transition(nodeId: string, patch: (cur: NodeRuntime) => Partial<NodeRuntime> | void): void;
  listLive(): LiveTurnSnapshot[];
}

export interface NodeRuntimeStoreDeps {
  /** liveSnapshot 变化时发布 revisioned 事件（revision 门控在此盖章）。 */
  publishLive(event: LiveTurnEvent): void;
  /** 记录过渡，供 trace 断言。 */
  onTransition?(info: { nodeId: string; kind: "live" | "patch" }): void;
}

export function createNodeRuntimeStore(deps: NodeRuntimeStoreDeps): NodeRuntimeStore {
  const records = new Map<string, NodeRuntime>();
  const revisions = new Map<string, number>();

  /** generation-bump 副作用：旧 active turn 标 stale + abort 底层 handle。 */
  function bumpActiveTurn(cur: NodeRuntime): void {
    if (!cur.activeTurn || cur.activeTurn.settled) return;
    cur.activeTurn.invalidated = true;
    cur.activeTurn.abortController.abort();
    cur.activeTurn.abortHandle?.abort();
  }

  function transition(nodeId: string, patch: (cur: NodeRuntime) => Partial<NodeRuntime> | void): void {
    const cur = records.get(nodeId);
    if (!cur || cur.disposed) return;
    const patchResult = patch(cur) ?? {};
    const next: NodeRuntime = { ...cur, ...patchResult };
    if (cur.node && next.node && next.node !== cur.node) {
      throw new Error(`transition must not replace node object identity (nodeId=${nodeId})`);
    }
    if (
      next.generation !== undefined &&
      cur.generation !== undefined &&
      next.generation !== cur.generation &&
      cur.activeTurn
    ) {
      bumpActiveTurn(cur);
    }
    let kind: "live" | "patch" = "patch";
    if (next.liveSnapshot !== cur.liveSnapshot) {
      kind = "live";
      const rev = (revisions.get(nodeId) ?? 0) + 1;
      revisions.set(nodeId, rev);
      if (next.liveSnapshot) {
        const stamped = { ...next.liveSnapshot, revision: rev };
        next.liveSnapshot = stamped;
        deps.publishLive({ type: "upsert", snapshot: stamped });
      } else {
        deps.publishLive({ type: "remove", nodeId, revision: rev });
      }
    }
    deps.onTransition?.({ nodeId, kind });
    records.set(nodeId, next);
  }

  return {
    get: (nodeId) => records.get(nodeId),
    has: (nodeId) => records.has(nodeId),
    entries: () => records.entries(),
    keys: () => records.keys(),
    nodes: function* nodes() {
      for (const record of records.values()) yield record.node;
    },
    set: (nodeId, record) => {
      records.set(nodeId, record);
    },
    delete: (nodeId) => records.delete(nodeId),
    replaceNode: (nodeId, node) => {
      const cur = records.get(nodeId);
      if (cur) records.set(nodeId, { ...cur, node });
      else records.set(nodeId, { node, pendingSkillIds: [] });
    },
    markDisposed: (nodeId) => {
      const cur = records.get(nodeId);
      if (!cur || cur.disposed) return;
      bumpActiveTurn(cur);
      const next: NodeRuntime = { ...cur, disposed: true, generation: (cur.generation ?? 0) + 1 };
      records.set(nodeId, next);
      // 无活跃 turn → 立即移除；有活跃 turn → 等 settle 后清理（见 turnRunner.settle）。
      if (!next.activeTurn) records.delete(nodeId);
    },
    transition,
    listLive: () => [...records.values()].flatMap((r) => (r.liveSnapshot ? [r.liveSnapshot] : [])),
  };
}
