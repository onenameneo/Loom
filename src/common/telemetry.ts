/** Provider-neutral usage and metric DTOs shared by main, preload and renderer. */
export type UsageSource = "provider" | "estimated";

export interface LlmCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface LlmUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost?: LlmCost;
  exact: boolean;
  source: UsageSource;
}

export interface UsageFacts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  total: number;
  cost?: LlmCost;
  exact: boolean;
  source: UsageSource;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const number = finiteNonNegative(value[key]);
    if (number !== undefined) return number;
  }
  return undefined;
}

function normalizeCost(value: unknown): LlmCost | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cost = value as Record<string, unknown>;
  const input = finiteNonNegative(cost.input);
  const output = finiteNonNegative(cost.output);
  const cacheRead = finiteNonNegative(cost.cacheRead);
  const cacheWrite = finiteNonNegative(cost.cacheWrite);
  const total = finiteNonNegative(cost.total);
  if ([input, output, cacheRead, cacheWrite, total].every((item) => item === undefined)) return undefined;
  const resolvedInput = input ?? 0;
  const resolvedOutput = output ?? 0;
  const resolvedCacheRead = cacheRead ?? 0;
  const resolvedCacheWrite = cacheWrite ?? 0;
  return {
    input: resolvedInput,
    output: resolvedOutput,
    cacheRead: resolvedCacheRead,
    cacheWrite: resolvedCacheWrite,
    total: total ?? resolvedInput + resolvedOutput + resolvedCacheRead + resolvedCacheWrite,
  };
}

/** One compatibility reader shared by provider normalization and trace display. */
export function readUsageFacts(value: unknown): UsageFacts | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const hasCanonicalSpecificField = ["input", "output", "cacheRead", "cacheWrite", "reasoning"].some((key) => finiteNonNegative(usage[key]) !== undefined);
  const legacyKeys = ["inputTokens", "promptTokens", "prompt_tokens", "input_tokens", "outputTokens", "completionTokens", "completion_tokens", "output_tokens", "cachedTokens", "cacheTokens", "cached_tokens", "promptCacheHitTokens", "prompt_cache_hit_tokens", "reasoningTokens", "reasoning_tokens"];
  const hasLegacyField = legacyKeys.some((key) => finiteNonNegative(usage[key]) !== undefined);
  const hasCanonicalField = hasCanonicalSpecificField || (!hasLegacyField && finiteNonNegative(usage.totalTokens) !== undefined);
  if (!hasCanonicalField && !hasLegacyField) return undefined;
  const input = firstNumber(usage, ["input", "inputTokens", "promptTokens", "prompt_tokens", "input_tokens"]) ?? 0;
  const output = firstNumber(usage, ["output", "outputTokens", "completionTokens", "completion_tokens", "output_tokens"]) ?? 0;
  const cacheRead = firstNumber(usage, ["cacheRead", "cacheReadTokens", "cachedTokens", "cacheTokens", "cached_tokens", "promptCacheHitTokens", "prompt_cache_hit_tokens"]) ?? 0;
  const cacheWrite = firstNumber(usage, ["cacheWrite", "cacheWriteTokens"]) ?? 0;
  const reasoning = firstNumber(usage, ["reasoning", "reasoningTokens", "reasoning_tokens"]);
  const total = firstNumber(usage, ["totalTokens", "total_tokens", "total"]) ?? input + output + cacheRead + cacheWrite;
  const cost = normalizeCost(usage.cost);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning !== undefined ? { reasoning } : {}),
    total,
    ...(cost ? { cost } : {}),
    exact: hasCanonicalField,
    source: hasCanonicalField ? "provider" : "estimated",
  };
}

export type AgentMetricKind = "turn" | "llm" | "tool" | "compaction";

export interface AgentMetricRecord {
  id: string;
  nodeId: string;
  sessionId: string;
  turnId?: string;
  requestId?: string;
  toolCallId?: string;
  kind: AgentMetricKind;
  providerId?: string;
  modelId?: string;
  name?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  ttftMs?: number;
  status: "ok" | "error" | "aborted";
  usage?: LlmUsage;
  createdAt: number;
}

export interface AgentMetricTotals {
  turns: number;
  llmRequests: number;
  toolCalls: number;
  compactions: number;
  durationMs: number;
  ttftMs: number;
  ttftSamples: number;
  outputTokensPerSecond: number;
  usage?: LlmUsage;
}
