import type { AgentMessage } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// ① 领域核心 · 分支图模型与树运算（纯 TS，零基础设施依赖）。
//
// 一张画布 = 一棵单父树。这里只有「数据形状 + 纯树运算」，不碰运行时缓存、
// 存储或 pi。运算通过注入的 lookup / 节点集合工作，由 ② 应用编排提供数据来源。
// pi 类型只以 `import type` 引入（编译期擦除，不构成值依赖）。
// ---------------------------------------------------------------------------

/** seed = 从来源节点某段回复划选出来的片段快照（不随来源变化）。 */
export type Seed = { text: string; from: string; parent: string };

/**
 * 核心视角下的节点：只含树运算 / 上下文装配 / 预算所需的字段。
 * 运行时的 CanvasNode（含 layout/color/messageMeta 等）是它的结构超集，可直接传入。
 */
export interface CanvasNodeModel {
  id: string;
  parentId?: string;
  seed?: Seed;
  mountAncestors: boolean;
  messages: AgentMessage[];
}

/** 按 id 解析节点（由 ② 提供：先内存后存储）。 */
export type NodeLookup<T extends CanvasNodeModel = CanvasNodeModel> = (id: string) => T | undefined;

/**
 * 沿 parentId 从 root→父收集路径上的节点（不含自身），带环路 guard。
 * 返回顺序 root → 父。
 */
export function ancestorChain<T extends CanvasNodeModel>(nodeId: string, lookup: NodeLookup<T>): T[] {
  const chain: T[] = [];
  let cur = lookup(nodeId)?.parentId;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const n = lookup(cur);
    if (!n) break;
    chain.push(n);
    cur = n.parentId;
  }
  return chain.reverse(); // root → 父
}

/**
 * 枚举某节点的所有后代 id（深度优先），从给定节点全集中查子节点。
 */
export function descendants<T extends CanvasNodeModel>(nodeId: string, all: Iterable<T>): string[] {
  const nodes = [...all];
  const out: string[] = [];
  const walk = (id: string) => {
    for (const node of nodes) {
      if (node.parentId === id) {
        out.push(node.id);
        walk(node.id);
      }
    }
  };
  walk(nodeId);
  return out;
}
