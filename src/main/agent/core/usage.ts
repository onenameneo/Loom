import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

export type UsageSource = "provider" | "estimated";

export interface LlmCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Loom's provider-neutral representation of model accounting. */
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

type UsageLike = Partial<Usage> & Record<string, unknown>;

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstNumber(value: UsageLike, ...keys: string[]): number | undefined {
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

/**
 * Normalize Pi usage and legacy Loom usage. The function is deliberately
 * defensive because persisted messages can outlive a provider package version.
 */
export function normalizeLlmUsage(value: unknown, options: { source?: UsageSource; exact?: boolean } = {}): LlmUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as UsageLike;
  const hasCanonicalSpecificField = ["input", "output", "cacheRead", "cacheWrite", "reasoning"].some((key) => finiteNonNegative(usage[key]) !== undefined);
  const input = firstNumber(usage, "input", "inputTokens", "promptTokens") ?? 0;
  const output = firstNumber(usage, "output", "outputTokens", "completionTokens") ?? 0;
  const cacheRead = firstNumber(usage, "cacheRead", "cacheReadTokens", "cachedTokens", "cacheTokens") ?? 0;
  const cacheWrite = firstNumber(usage, "cacheWrite", "cacheWriteTokens") ?? 0;
  const reasoning = firstNumber(usage, "reasoning", "reasoningTokens");
  const reportedTotal = firstNumber(usage, "totalTokens", "total");
  const hasLegacyField = ["inputTokens", "promptTokens", "outputTokens", "completionTokens", "cachedTokens", "cacheTokens", "reasoningTokens"].some((key) => finiteNonNegative(usage[key]) !== undefined);
  const hasCanonicalField = hasCanonicalSpecificField || (!hasLegacyField && finiteNonNegative(usage.totalTokens) !== undefined);
  const hasAnyTokenField = hasCanonicalField || hasLegacyField;
  if (!hasAnyTokenField) return undefined;
  const totalTokens = reportedTotal ?? input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning !== undefined ? { reasoning } : {}),
    totalTokens,
    ...(normalizeCost(usage.cost) ? { cost: normalizeCost(usage.cost) } : {}),
    exact: options.exact ?? hasCanonicalField,
    source: options.source ?? (hasCanonicalField ? "provider" : "estimated"),
  };
}

export function usageFromMessage(message: AgentMessage | unknown): LlmUsage | undefined {
  return normalizeLlmUsage((message as { usage?: unknown } | undefined)?.usage);
}

export function usageTotalTokens(usage: LlmUsage | undefined): number {
  return usage?.totalTokens ?? 0;
}

export function mergeLlmUsage(values: Array<LlmUsage | undefined>): LlmUsage | undefined {
  const present = values.filter((value): value is LlmUsage => Boolean(value));
  if (present.length === 0) return undefined;
  const result = present.reduce<LlmUsage>((acc, value) => ({
    input: acc.input + value.input,
    output: acc.output + value.output,
    cacheRead: acc.cacheRead + value.cacheRead,
    cacheWrite: acc.cacheWrite + value.cacheWrite,
    totalTokens: acc.totalTokens + value.totalTokens,
    exact: acc.exact && value.exact,
    source: acc.source === "provider" && value.source === "provider" ? "provider" : "estimated",
    ...(acc.reasoning !== undefined || value.reasoning !== undefined ? { reasoning: (acc.reasoning ?? 0) + (value.reasoning ?? 0) } : {}),
    ...(acc.cost || value.cost ? {
      cost: {
        input: (acc.cost?.input ?? 0) + (value.cost?.input ?? 0),
        output: (acc.cost?.output ?? 0) + (value.cost?.output ?? 0),
        cacheRead: (acc.cost?.cacheRead ?? 0) + (value.cost?.cacheRead ?? 0),
        cacheWrite: (acc.cost?.cacheWrite ?? 0) + (value.cost?.cacheWrite ?? 0),
        total: (acc.cost?.total ?? 0) + (value.cost?.total ?? 0),
      },
    } : {}),
  }), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    exact: true,
    source: "provider",
  });
  return result;
}
