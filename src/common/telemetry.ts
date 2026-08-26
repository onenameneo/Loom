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

function firstNumber(value: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const number = finiteNonNegative(value[key]);
    if (number !== undefined) return number;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

type UsageRecord = Record<string, unknown>;

interface ParsedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  total?: number;
  exact: boolean;
  source: UsageSource;
}

type UsageReader = (usage: UsageRecord) => UsageFacts | undefined;

const CANONICAL_KEYS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"] as const;
const CANONICAL_INPUT_KEYS = ["input"];
const CANONICAL_OUTPUT_KEYS = ["output"];
const CANONICAL_CACHE_READ_KEYS = ["cacheRead"];
const CANONICAL_CACHE_WRITE_KEYS = ["cacheWrite"];
const CANONICAL_REASONING_KEYS = ["reasoning"];

const COMPAT_INPUT_KEYS = ["input", "inputTokens", "promptTokens", "prompt_tokens"];
const COMPAT_OUTPUT_KEYS = ["output", "outputTokens", "completionTokens", "completion_tokens"];
const COMPAT_CACHE_READ_KEYS = ["cacheRead", "cacheReadTokens", "cachedTokens", "cacheTokens", "cached_tokens", "promptCacheHitTokens", "prompt_cache_hit_tokens"];
const COMPAT_CACHE_WRITE_KEYS = ["cacheWrite", "cacheWriteTokens"];
const COMPAT_REASONING_KEYS = ["reasoning", "reasoningTokens", "reasoning_tokens"];
const TOTAL_KEYS = ["totalTokens", "total_tokens", "total"];

const LEGACY_KEYS = [
  "inputTokens", "promptTokens", "prompt_tokens", "input_tokens",
  "outputTokens", "completionTokens", "completion_tokens", "output_tokens",
  "cachedTokens", "cacheTokens", "cached_tokens", "promptCacheHitTokens", "prompt_cache_hit_tokens",
  "reasoningTokens", "reasoning_tokens",
];

function hasNumber(value: UsageRecord | undefined, keys: readonly string[]): boolean {
  return value ? keys.some((key) => finiteNonNegative(value[key]) !== undefined) : false;
}

function hasAnyNumericProperty(value: UsageRecord | undefined): boolean {
  return value ? Object.values(value).some((item) => finiteNonNegative(item) !== undefined) : false;
}

function responseDetails(usage: UsageRecord): { input?: UsageRecord; output?: UsageRecord } {
  return {
    input: objectValue(usage.input_tokens_details),
    output: objectValue(usage.output_tokens_details),
  };
}

function isResponsesUsage(usage: UsageRecord): boolean {
  const details = responseDetails(usage);
  return hasNumber(usage, ["input_tokens", "output_tokens", "total_tokens"])
    || hasAnyNumericProperty(details.input)
    || hasAnyNumericProperty(details.output);
}

function toUsageFacts(usage: UsageRecord, parsed: ParsedUsage): UsageFacts {
  const input = parsed.input ?? 0;
  const output = parsed.output ?? 0;
  const cacheRead = parsed.cacheRead ?? 0;
  const cacheWrite = parsed.cacheWrite ?? 0;
  const cost = normalizeCost(usage.cost);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(parsed.reasoning !== undefined ? { reasoning: parsed.reasoning } : {}),
    total: parsed.total ?? input + output + cacheRead + cacheWrite,
    ...(cost ? { cost } : {}),
    exact: parsed.exact,
    source: parsed.source,
  };
}

function readAliasedUsage(usage: UsageRecord, provenance: Pick<ParsedUsage, "exact" | "source">): UsageFacts {
  return toUsageFacts(usage, {
    input: firstNumber(usage, COMPAT_INPUT_KEYS),
    output: firstNumber(usage, COMPAT_OUTPUT_KEYS),
    cacheRead: firstNumber(usage, COMPAT_CACHE_READ_KEYS),
    cacheWrite: firstNumber(usage, COMPAT_CACHE_WRITE_KEYS),
    reasoning: firstNumber(usage, COMPAT_REASONING_KEYS),
    total: firstNumber(usage, TOTAL_KEYS),
    ...provenance,
  });
}

function readCanonicalUsage(usage: UsageRecord): UsageFacts | undefined {
  const hasCanonicalFields = hasNumber(usage, CANONICAL_KEYS);
  const canUseCanonicalTotal = !hasCanonicalFields
    && !hasNumber(usage, LEGACY_KEYS)
    && !isResponsesUsage(usage)
    && finiteNonNegative(usage.totalTokens) !== undefined;
  if (!hasCanonicalFields && !canUseCanonicalTotal) return undefined;

  return readAliasedUsage(usage, {
    exact: true,
    source: "provider",
  });
}

function readResponsesUsage(usage: UsageRecord): UsageFacts | undefined {
  if (!isResponsesUsage(usage)) return undefined;

  const details = responseDetails(usage);
  const cached = firstNumber(details.input ?? {}, ["cached_tokens", "cache_read_tokens"]) ?? 0;
  const cacheWrite = firstNumber(details.input ?? {}, ["cache_write_tokens"]) ?? 0;
  const inputTokens = firstNumber(usage, ["input_tokens"]);
  const outputTokens = firstNumber(usage, ["output_tokens"]);

  return toUsageFacts(usage, {
    input: firstNumber(usage, CANONICAL_INPUT_KEYS)
      ?? (inputTokens !== undefined ? Math.max(0, inputTokens - cached - cacheWrite) : undefined),
    output: firstNumber(usage, CANONICAL_OUTPUT_KEYS) ?? outputTokens,
    cacheRead: firstNumber(usage, CANONICAL_CACHE_READ_KEYS) ?? cached,
    cacheWrite: firstNumber(usage, CANONICAL_CACHE_WRITE_KEYS) ?? cacheWrite,
    reasoning: firstNumber(usage, CANONICAL_REASONING_KEYS)
      ?? firstNumber(details.output ?? {}, ["reasoning_tokens", "thinking_tokens"]),
    total: firstNumber(usage, TOTAL_KEYS),
    exact: true,
    source: "provider",
  });
}

function readLegacyUsage(usage: UsageRecord): UsageFacts | undefined {
  if (!hasNumber(usage, LEGACY_KEYS)) return undefined;

  return readAliasedUsage(usage, {
    exact: false,
    source: "estimated",
  });
}

/**
 * Reader order is the compatibility contract: canonical values win, then
 * recognized provider payloads, then historical aliases.
 *
 * A new provider format should get its own reader and be added here; the
 * normalization and legacy readers do not need to grow another branch.
 */
const usageReaders: readonly UsageReader[] = [
  readCanonicalUsage,
  readResponsesUsage,
  readLegacyUsage,
];

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
  const usage = objectValue(value);
  if (!usage) return undefined;
  for (const reader of usageReaders) {
    const facts = reader(usage);
    if (facts) return facts;
  }
  return undefined;
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
