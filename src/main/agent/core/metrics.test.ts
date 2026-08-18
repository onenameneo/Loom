import { describe, expect, it } from "vitest";
import type { AgentMetricRecord } from "../../store/store";
import { summarizeMetricRecords } from "./metrics";

describe("summarizeMetricRecords", () => {
  it("uses turn wall time and only LLM usage for the aggregate", () => {
    const records: AgentMetricRecord[] = [
      { id: "turn", nodeId: "n1", sessionId: "s1", kind: "turn", durationMs: 1_000, status: "ok", createdAt: 1 },
      {
        id: "llm-1", nodeId: "n1", sessionId: "s1", kind: "llm", durationMs: 200, ttftMs: 100, status: "ok", createdAt: 2,
        usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 0, totalTokens: 35, exact: true, source: "provider" },
      },
      {
        id: "llm-2", nodeId: "n1", sessionId: "s1", kind: "llm", durationMs: 100, status: "ok", createdAt: 3,
        usage: { input: 2, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 12, exact: true, source: "provider" },
      },
      {
        id: "tool", nodeId: "n1", sessionId: "s1", kind: "tool", durationMs: 5_000, status: "ok", createdAt: 4,
        usage: { input: 100, output: 1_000, cacheRead: 0, cacheWrite: 0, totalTokens: 1_100, exact: true, source: "provider" },
      },
    ];

    expect(summarizeMetricRecords(records)).toEqual({
      turns: 1,
      llmRequests: 2,
      toolCalls: 1,
      compactions: 0,
      durationMs: 1_000,
      ttftMs: 100,
      ttftSamples: 1,
      outputTokensPerSecond: 100,
      usage: { input: 12, output: 30, cacheRead: 5, cacheWrite: 0, totalTokens: 47, exact: true, source: "provider" },
    });
  });
});
