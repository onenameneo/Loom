import type { CanvasNodeModel } from "./graph";
import { textOf } from "./context";

// ---------------------------------------------------------------------------
// ① 领域核心 · token 预算规则（纯 TS，零基础设施依赖）。
//
// pi-ai 无同步 token 计数器；自定义 endpoint（如 mimo 代理）也拿不到真实计数，
// 故统一用字符估算：中英混排粗略 ~2 字符/token。含/不含祖先各给一个数，标注为估算。
// （真实 usage 计量留到 H3。）
// ---------------------------------------------------------------------------

export interface Budget {
  withoutAncestors: number;
  withAncestors: number;
  estimated: boolean;
}

export function estTokens(chars: number): number {
  return Math.round(chars / 2);
}

/** 本节点自身内容字符数（seed + 各消息文本）。 */
export function ownChars(node: Pick<CanvasNodeModel, "seed" | "messages">): number {
  let c = node.seed ? node.seed.text.length : 0;
  for (const m of node.messages) c += textOf(m).length;
  return c;
}

/**
 * 估算某节点上下文预算：不含 / 含祖先。
 * @param ancestors 已解析好的祖先链（用于统计祖先消息字符）。
 */
export function budget(node: Pick<CanvasNodeModel, "seed" | "messages">, ancestors: CanvasNodeModel[]): Budget {
  const own = ownChars(node);
  let anc = 0;
  for (const n of ancestors) for (const m of n.messages) anc += textOf(m).length;
  return { withoutAncestors: estTokens(own), withAncestors: estTokens(own + anc), estimated: true };
}
