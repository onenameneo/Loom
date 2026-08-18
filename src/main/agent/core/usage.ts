import { readUsageFacts, type LlmUsage, type UsageSource } from "../../../common/telemetry";

export type { LlmUsage, LlmCost, UsageSource } from "../../../common/telemetry";

/**
 * Normalize Pi usage and legacy Loom usage. The function is deliberately
 * defensive because persisted messages can outlive a provider package version.
 */
export function normalizeLlmUsage(value: unknown, options: { source?: UsageSource; exact?: boolean } = {}): LlmUsage | undefined {
  const facts = readUsageFacts(value);
  if (!facts) return undefined;
  return {
    input: facts.input,
    output: facts.output,
    cacheRead: facts.cacheRead,
    cacheWrite: facts.cacheWrite,
    ...(facts.reasoning !== undefined ? { reasoning: facts.reasoning } : {}),
    totalTokens: facts.total,
    ...(facts.cost ? { cost: facts.cost } : {}),
    exact: options.exact ?? facts.exact,
    source: options.source ?? facts.source,
  };
}

export function usageFromMessage(message: unknown): LlmUsage | undefined {
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
