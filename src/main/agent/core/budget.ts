import type { CanvasNodeModel } from "./graph";
import { textOf } from "./context";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { usageFromMessage } from "./usage";

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
  model?: { providerId: string; modelId: string };
  contextWindowTokens?: number;
  reserveOutputTokens?: number;
  safeInputBudget?: number;
  projectedInputTokens?: number;
  fixedContextTokens?: number;
  nodeLocalTailBudgetTokens?: number;
  attachmentBudgetTokens?: number;
  overflowTokens?: number;
  status?: ContextBudgetStatus;
  source?: TokenAccountingSource;
}

export type TokenAccountingSource = "exact" | "mixed" | "estimated";

/** Model metadata needed by the final-request budget planner. */
export interface ContextModelMetadata {
  providerId: string;
  modelId: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  available?: boolean;
  diagnostic?: string;
}

export interface TranscriptTokenAccounting {
  tokens: number;
  exact: boolean;
  providerTokens: number;
  estimatedTokens: number;
  providerMessageIndex?: number;
  source: TokenAccountingSource;
}

export const MAX_ESTIMATED_MESSAGE_TOKENS = 8192;

export interface TokenDiagnosticInput {
  tokens: number;
  exact: boolean;
}

export interface FinalRequestBudgetInput {
  contextWindowTokens: number;
  reserveTokens: number;
  systemTokens: TokenDiagnosticInput;
  frozenBranchTokens: TokenDiagnosticInput;
  seedTokens: TokenDiagnosticInput;
  dynamicTailAllowanceTokens: number;
  pendingUserInputTokens: TokenDiagnosticInput;
  checkpointSummaryAllowanceTokens: number;
}

export interface FinalRequestBudgetAllocation {
  status: "ok" | "fixed-context-overflow";
  safeInputBudget: number;
  fixedContextTokens: number;
  nodeLocalTailBudget: number;
  overflowTokens: number;
  exact: boolean;
  parts: {
    system: TokenDiagnosticInput;
    frozenBranch: TokenDiagnosticInput;
    seed: TokenDiagnosticInput;
    dynamicTailAllowance: TokenDiagnosticInput;
    pendingUserInput: TokenDiagnosticInput;
    checkpointSummaryAllowance: TokenDiagnosticInput;
  };
}

export interface ContextBudgetInput {
  model?: ContextModelMetadata;
  /** Optional application cap; the model's max output is always the upper bound. */
  reserveOutputTokens?: number;
  safetyMarginTokens?: number;
  systemTokens: TokenDiagnosticInput;
  toolTokens: TokenDiagnosticInput;
  frozenBranchTokens: TokenDiagnosticInput;
  seedTokens: TokenDiagnosticInput;
  dynamicContextTokens?: TokenDiagnosticInput;
  pendingUserInputTokens: TokenDiagnosticInput;
  checkpointSummaryTokens: TokenDiagnosticInput;
  /** The model-facing transcript, including any synthetic checkpoint/seed messages. */
  projectedMessages: AgentMessage[];
}

export type ContextBudgetStatus =
  | "ok"
  | "needs-compaction"
  | "fixed-context-overflow"
  | "model-unavailable";

export interface ContextBudgetAllocation {
  status: ContextBudgetStatus;
  model?: ContextModelMetadata;
  safeInputBudget: number;
  reserveOutputTokens: number;
  safetyMarginTokens: number;
  projectedInputTokens: number;
  fixedContextTokens: number;
  nodeLocalTailBudget: number;
  attachmentBudgetTokens: number;
  overflowTokens: number;
  source: TokenAccountingSource;
  exact: boolean;
  transcript: TranscriptTokenAccounting;
  parts: {
    system: TokenDiagnosticInput;
    tools: TokenDiagnosticInput;
    frozenBranch: TokenDiagnosticInput;
    seed: TokenDiagnosticInput;
    dynamicContext: TokenDiagnosticInput;
    pendingUserInput: TokenDiagnosticInput;
    checkpointSummary: TokenDiagnosticInput;
  };
}

export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 2_048;
export const DEFAULT_MAX_RESERVED_OUTPUT_TOKENS = 16_000;
export const DEFAULT_CONTEXT_ATTACHMENT_BUDGET_TOKENS = 12_000;
export const DEFAULT_CONTEXT_ATTACHMENT_SUMMARY_RESERVE_TOKENS = 2_048;

export function estTokens(chars: number): number {
  return Math.round(chars / 2);
}

export function estimateMessageTokens(msg: AgentMessage): number {
  const text = textOf(msg);
  if (text.length === 0) return 0;
  return Math.min(MAX_ESTIMATED_MESSAGE_TOKENS, Math.max(1, estTokens(text.length)));
}

export function estimateMessageTokensUnbounded(msg: AgentMessage): number {
  const text = textOf(msg);
  if (text.length === 0) return 0;
  return Math.max(1, estTokens(text.length));
}

export function validUsageTokens(msg: AgentMessage): number | undefined {
  const usage = usageFromMessage(msg);
  return usage?.totalTokens;
}

export function accountTranscriptTokens(messages: AgentMessage[]): TranscriptTokenAccounting {
  for (let i = messages.length - 1; i >= 0; i--) {
    const providerTokens = validUsageTokens(messages[i]!);
    if (providerTokens === undefined) continue;
    const estimatedTokens = messages.slice(i + 1).reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
    return {
      tokens: providerTokens + estimatedTokens,
      exact: estimatedTokens === 0,
      providerTokens,
      estimatedTokens,
      providerMessageIndex: i,
      source: estimatedTokens === 0 ? "exact" : "mixed",
    };
  }
  const estimatedTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  return {
    tokens: estimatedTokens,
    exact: false,
    providerTokens: 0,
    estimatedTokens,
    source: "estimated",
  };
}

export function allocateFinalRequestBudget(input: FinalRequestBudgetInput): FinalRequestBudgetAllocation {
  const safeInputBudget = Math.max(0, input.contextWindowTokens - input.reserveTokens);
  const parts: FinalRequestBudgetAllocation["parts"] = {
    system: normalizeDiagnostic(input.systemTokens),
    frozenBranch: normalizeDiagnostic(input.frozenBranchTokens),
    seed: normalizeDiagnostic(input.seedTokens),
    dynamicTailAllowance: { tokens: nonNegative(input.dynamicTailAllowanceTokens), exact: false },
    pendingUserInput: normalizeDiagnostic(input.pendingUserInputTokens),
    checkpointSummaryAllowance: { tokens: nonNegative(input.checkpointSummaryAllowanceTokens), exact: false },
  };
  const fixedContextTokens =
    parts.system.tokens +
    parts.frozenBranch.tokens +
    parts.seed.tokens +
    parts.dynamicTailAllowance.tokens +
    parts.pendingUserInput.tokens +
    parts.checkpointSummaryAllowance.tokens;
  const overflowTokens = Math.max(0, fixedContextTokens - safeInputBudget);
  return {
    status: overflowTokens > 0 ? "fixed-context-overflow" : "ok",
    safeInputBudget,
    fixedContextTokens,
    nodeLocalTailBudget: Math.max(0, safeInputBudget - fixedContextTokens),
    overflowTokens,
    exact: Object.values(parts).every((part) => part.exact),
    parts,
  };
}

/**
 * Allocate the final model request, including fixed context and a model-local
 * recent tail. Provider usage is treated as the authoritative transcript
 * baseline when available; otherwise the complete request is explicitly
 * estimated.
 */
export function allocateContextBudget(input: ContextBudgetInput): ContextBudgetAllocation {
  const model = input.model;
  const safetyMarginTokens = nonNegative(input.safetyMarginTokens ?? DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS);
  const parts = {
    system: normalizeDiagnostic(input.systemTokens),
    tools: normalizeDiagnostic(input.toolTokens),
    frozenBranch: normalizeDiagnostic(input.frozenBranchTokens),
    seed: normalizeDiagnostic(input.seedTokens),
    dynamicContext: normalizeDiagnostic(input.dynamicContextTokens ?? { tokens: 0, exact: true }),
    pendingUserInput: normalizeDiagnostic(input.pendingUserInputTokens),
    checkpointSummary: normalizeDiagnostic(input.checkpointSummaryTokens),
  };
  const fixedContextTokens = Object.values(parts).reduce((sum, part) => sum + part.tokens, 0);
  const transcript = accountTranscriptTokens(input.projectedMessages);
  const fixedTranscriptTokens =
    parts.frozenBranch.tokens +
    parts.seed.tokens +
    parts.pendingUserInput.tokens +
    parts.checkpointSummary.tokens;
  const source = combineSources(
    transcript.source,
    Object.values(parts).some((part) => !part.exact) ? "estimated" : "exact",
  );

  if (!model || model.available === false || !validPositive(model.contextWindowTokens) || !validPositive(model.maxOutputTokens)) {
    return {
      status: "model-unavailable",
      model,
      safeInputBudget: 0,
      reserveOutputTokens: 0,
      safetyMarginTokens,
      projectedInputTokens: fixedContextTokens + transcript.tokens,
      fixedContextTokens,
      nodeLocalTailBudget: 0,
      attachmentBudgetTokens: 0,
      overflowTokens: 0,
      source,
      exact: false,
      transcript,
      parts,
    };
  }

  const reserveOutputTokens = Math.min(
    model.maxOutputTokens,
    nonNegative(input.reserveOutputTokens ?? DEFAULT_MAX_RESERVED_OUTPUT_TOKENS),
  );
  const safeInputBudget = Math.max(0, Math.round(model.contextWindowTokens) - reserveOutputTokens);
  const overflowTokens = Math.max(0, fixedContextTokens - safeInputBudget);
  const nodeLocalTailBudget = Math.max(0, safeInputBudget - fixedContextTokens);
  // Attachments belong to the next checkpoint projection, not to the current
  // source tail. Reserve summary space and derive a separate allowance from
  // model capacity plus static context only.
  const fixedContextWithoutCheckpoint =
    parts.system.tokens +
    parts.tools.tokens +
    parts.frozenBranch.tokens +
    parts.seed.tokens +
    parts.dynamicContext.tokens +
    parts.pendingUserInput.tokens;
  const attachmentBudgetTokens = Math.min(
    DEFAULT_CONTEXT_ATTACHMENT_BUDGET_TOKENS,
    Math.max(0, safeInputBudget - fixedContextWithoutCheckpoint - DEFAULT_CONTEXT_ATTACHMENT_SUMMARY_RESERVE_TOKENS),
  );
  // A provider total may already include system/tools. Avoid double-counting
  // those fixed parts when a valid usage baseline is available.
  const estimatedLocalTranscriptTokens = Math.max(0, transcript.tokens - fixedTranscriptTokens);
  const projectedInputTokens = transcript.providerTokens > 0
    ? Math.max(fixedContextTokens, transcript.tokens)
    : fixedContextTokens + estimatedLocalTranscriptTokens;
  const status: ContextBudgetStatus = overflowTokens > 0
    ? "fixed-context-overflow"
    : projectedInputTokens >= Math.max(0, safeInputBudget - safetyMarginTokens)
      ? "needs-compaction"
      : "ok";

  return {
    status,
    model,
    safeInputBudget,
    reserveOutputTokens,
    safetyMarginTokens,
    projectedInputTokens,
    fixedContextTokens,
    nodeLocalTailBudget,
    attachmentBudgetTokens,
    overflowTokens,
    source,
    exact: source === "exact",
    transcript,
    parts,
  };
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

function normalizeDiagnostic(input: TokenDiagnosticInput): TokenDiagnosticInput {
  return { tokens: nonNegative(input.tokens), exact: Boolean(input.exact) };
}

function combineSources(left: TokenAccountingSource, right: TokenAccountingSource): TokenAccountingSource {
  if (left === "estimated" || right === "estimated") return "estimated";
  if (left === "mixed" || right === "mixed") return "mixed";
  return "exact";
}

function validPositive(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegative(value: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
