import { describe, expect, it } from "vitest";
import { mergeLlmUsage, normalizeLlmUsage, usageFromMessage } from "./usage";

describe("canonical usage", () => {
  it("normalizes Pi usage and preserves cost", () => {
    expect(normalizeLlmUsage({
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 2,
      reasoning: 1,
      totalTokens: 19,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    })).toEqual({
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 2,
      reasoning: 1,
      totalTokens: 19,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
      exact: true,
      source: "provider",
    });
  });

  it("reads legacy fields as estimated compatibility data", () => {
    expect(normalizeLlmUsage({ inputTokens: 8, outputTokens: 2, totalTokens: 10 })).toMatchObject({
      input: 8,
      output: 2,
      totalTokens: 10,
      exact: false,
      source: "estimated",
    });
  });

  it("derives total when a provider omits it", () => {
    expect(normalizeLlmUsage({ input: 2, output: 3, cacheRead: 4, cacheWrite: 1 })?.totalTokens).toBe(10);
  });

  it("normalizes raw OpenAI Responses usage details", () => {
    expect(normalizeLlmUsage({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
      output_tokens_details: { reasoning_tokens: 7 },
    })).toEqual({
      input: 15,
      output: 20,
      cacheRead: 80,
      cacheWrite: 5,
      reasoning: 7,
      totalTokens: 120,
      exact: true,
      source: "provider",
    });
  });

  it("prefers a recognized Responses payload over legacy aliases", () => {
    expect(normalizeLlmUsage({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 3,
    })).toMatchObject({
      input: 15,
      output: 20,
      cacheRead: 80,
      cacheWrite: 5,
      totalTokens: 120,
      exact: true,
      source: "provider",
    });
  });

  it("normalizes message usage", () => {
    expect(usageFromMessage({ usage: { input: 1, output: 2, totalTokens: 3 } })).toMatchObject({ totalTokens: 3 });
    expect(usageFromMessage({ role: "user", content: "hello" })).toBeUndefined();
  });

  it("merges totals and cost without losing provenance", () => {
    const merged = mergeLlmUsage([
      normalizeLlmUsage({ input: 1, output: 2, totalTokens: 3, cost: { total: 0.1 } }),
      normalizeLlmUsage({ inputTokens: 4, outputTokens: 5, totalTokens: 9 }),
    ]);
    expect(merged).toMatchObject({ input: 5, output: 7, totalTokens: 12, exact: false, source: "estimated", cost: { total: 0.1 } });
  });
});
