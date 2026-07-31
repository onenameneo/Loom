import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { LoomSkillEvent } from "../skills/types";

// ---------------------------------------------------------------------------
// ① 领域核心 · Loom 业务消息（"材料"）。
//
// pi-ai 的 Message 是 provider 可读的原子；pi-agent-core 的 AgentMessage
// 把它和应用可扩展消息组成 agent 转写。Loom 自有的、不可直接发送给 provider
// 的消息必须在此声明，并由 convertToLlm 明确转换或过滤。
// ---------------------------------------------------------------------------

/** 仅供 Loom 界面/持久化使用的消息；不会进入 provider 上下文。 */
export interface LoomUiMessage {
  role: "loomUi";
  kind: "chip" | "notice" | "timeline";
  content: string;
  timestamp: number;
}

export type LoomCompactionReason = "manual" | "threshold" | "overflow";

export interface LoomSourceRange {
  fromSeq: number;
  toSeq: number;
}

export interface LoomTokenDiagnostic {
  tokens: number;
  exact: boolean;
}

export interface LoomBudgetDiagnostics {
  before: LoomTokenDiagnostic;
  after: LoomTokenDiagnostic;
}

export interface LoomUsageDiagnostic {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  exact: boolean;
}

export interface LoomContextCheckpointMessage {
  role: "loomContextCheckpoint";
  version: 1;
  id: string;
  nodeId: string;
  createdAt: number;
  reason: LoomCompactionReason;
  summary: string;
  coverage: LoomSourceRange;
  retainedTail: LoomSourceRange;
  diagnostics: LoomBudgetDiagnostics;
  summaryUsage?: LoomUsageDiagnostic;
  invalidatedAt?: number;
}

export interface LoomSplitTurnContextMessage {
  role: "loomSplitTurnContext";
  version: 1;
  id: string;
  nodeId: string;
  createdAt: number;
  sourceTurn: LoomSourceRange;
  retainedSuffix: LoomSourceRange;
  summary: string;
  truncated: boolean;
}

export interface LoomFrozenBranchSummaryMessage {
  role: "loomFrozenBranchSummary";
  version: 1;
  id: string;
  childNodeId: string;
  createdAt: number;
  source: LoomSourceRange & {
    parentNodeId: string;
    fingerprint: string;
  };
  summary: string;
  retainedContext: Message[];
  diagnostics: LoomBudgetDiagnostics;
}

export type LoomDerivedContextMessage =
  | LoomContextCheckpointMessage
  | LoomSplitTurnContextMessage
  | LoomFrozenBranchSummaryMessage;

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    loomUi: LoomUiMessage;
    loomSkillEvent: LoomSkillEvent;
    loomContextCheckpoint: LoomContextCheckpointMessage;
    loomSplitTurnContext: LoomSplitTurnContextMessage;
    loomFrozenBranchSummary: LoomFrozenBranchSummaryMessage;
  }
}

/** Loom 的完整 agent 转写：pi 标准消息（"分子"）加业务消息（"材料"）。 */
export type LoomAgentMessage = AgentMessage;

export function createLoomContextCheckpoint(
  input: Omit<LoomContextCheckpointMessage, "role" | "version">,
): LoomContextCheckpointMessage {
  return { role: "loomContextCheckpoint", version: 1, ...input };
}

export function createLoomSplitTurnContext(
  input: Omit<LoomSplitTurnContextMessage, "role" | "version">,
): LoomSplitTurnContextMessage {
  return { role: "loomSplitTurnContext", version: 1, ...input };
}

export function createLoomFrozenBranchSummary(
  input: Omit<LoomFrozenBranchSummaryMessage, "role" | "version">,
): LoomFrozenBranchSummaryMessage {
  return { role: "loomFrozenBranchSummary", version: 1, ...input };
}

export function serializeLoomDerivedMessage(msg: AgentMessage): AgentMessage {
  return JSON.parse(JSON.stringify(msg)) as AgentMessage;
}

export function isLoomContextCheckpoint(msg: AgentMessage | unknown): msg is LoomContextCheckpointMessage {
  const value = asRecord(msg);
  return (
    value?.role === "loomContextCheckpoint" &&
    value.version === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.nodeId) &&
    isFiniteNumber(value.createdAt) &&
    isReason(value.reason) &&
    typeof value.summary === "string" &&
    isRange(value.coverage) &&
    isRange(value.retainedTail) &&
    isBudgetDiagnostics(value.diagnostics) &&
    (value.summaryUsage === undefined || isUsageDiagnostic(value.summaryUsage)) &&
    (value.invalidatedAt === undefined || isFiniteNumber(value.invalidatedAt))
  );
}

export function isLoomSplitTurnContext(msg: AgentMessage | unknown): msg is LoomSplitTurnContextMessage {
  const value = asRecord(msg);
  return (
    value?.role === "loomSplitTurnContext" &&
    value.version === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.nodeId) &&
    isFiniteNumber(value.createdAt) &&
    isRange(value.sourceTurn) &&
    isRange(value.retainedSuffix) &&
    typeof value.summary === "string" &&
    typeof value.truncated === "boolean"
  );
}

export function isLoomFrozenBranchSummary(msg: AgentMessage | unknown): msg is LoomFrozenBranchSummaryMessage {
  const value = asRecord(msg);
  const source = asRecord(value?.source);
  const hasFrozenSourceFields = isNonEmptyString(source?.parentNodeId) && isNonEmptyString(source?.fingerprint);
  return (
    value?.role === "loomFrozenBranchSummary" &&
    value.version === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.childNodeId) &&
    isFiniteNumber(value.createdAt) &&
    hasFrozenSourceFields &&
    isRange(source) &&
    typeof value.summary === "string" &&
    Array.isArray(value.retainedContext) &&
    isBudgetDiagnostics(value.diagnostics)
  );
}

export function isLoomDerivedContextMessage(msg: AgentMessage | unknown): msg is LoomDerivedContextMessage {
  return isLoomContextCheckpoint(msg) || isLoomSplitTurnContext(msg) || isLoomFrozenBranchSummary(msg);
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isReason(value: unknown): value is LoomCompactionReason {
  return value === "manual" || value === "threshold" || value === "overflow";
}

function isRange(value: unknown): value is LoomSourceRange {
  const range = asRecord(value);
  return Boolean(range && isFiniteNumber(range.fromSeq) && isFiniteNumber(range.toSeq) && range.fromSeq <= range.toSeq);
}

function isTokenDiagnostic(value: unknown): value is LoomTokenDiagnostic {
  const diagnostic = asRecord(value);
  return Boolean(diagnostic && isFiniteNumber(diagnostic.tokens) && diagnostic.tokens >= 0 && typeof diagnostic.exact === "boolean");
}

function isBudgetDiagnostics(value: unknown): value is LoomBudgetDiagnostics {
  const diagnostics = asRecord(value);
  return Boolean(diagnostics && isTokenDiagnostic(diagnostics.before) && isTokenDiagnostic(diagnostics.after));
}

function isUsageDiagnostic(value: unknown): value is LoomUsageDiagnostic {
  const usage = asRecord(value);
  if (!usage || typeof usage.exact !== "boolean") return false;
  return ["inputTokens", "outputTokens", "totalTokens"].every((key) => usage[key] === undefined || isFiniteNumber(usage[key]));
}
