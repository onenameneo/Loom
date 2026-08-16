import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { accountTranscriptTokens, allocateContextBudget, allocateFinalRequestBudget, budget, estimateMessageTokens, estimateMessageTokensUnbounded, estTokens, ownChars } from "./budget";
import type { CanvasNodeModel } from "./graph";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;

function node(messages: AgentMessage[], seed?: { text: string }): CanvasNodeModel {
  return { id: "n", messages, seed: seed as any };
}

describe("estTokens / ownChars", () => {
  it("estimates ~2 chars per token", () => {
    expect(estTokens(10)).toBe(5);
  });
  it("counts seed + message chars", () => {
    expect(ownChars(node([user("abcd")], { text: "xy" }))).toBe(6);
  });
});

describe("budget", () => {
  it("equals own estimate when no ancestors", () => {
    const b = budget(node([user("abcd")]), []);
    expect(b).toEqual({ withoutAncestors: 2, withAncestors: 2, estimated: true });
  });

  it("adds ancestor chars only into withAncestors", () => {
    const anc: CanvasNodeModel[] = [{ id: "p", messages: [user("efgh")] }];
    const b = budget(node([user("abcd")]), anc);
    expect(b.withoutAncestors).toBe(2); // 4 chars
    expect(b.withAncestors).toBe(4); // 8 chars
    expect(b.estimated).toBe(true);
  });
});

describe("token accounting", () => {
  it("uses newest valid provider usage and estimates later messages as mixed diagnostics", () => {
    const messages = [
      user("older question"),
      { role: "assistant", content: "older answer", timestamp: 0, usage: { totalTokens: 100 } } as unknown as AgentMessage,
      user("new words"),
    ];

    const accounting = accountTranscriptTokens(messages);

    expect(accounting).toMatchObject({
      tokens: 105,
      exact: false,
      providerTokens: 100,
      estimatedTokens: 5,
      providerMessageIndex: 1,
      source: "mixed",
    });
  });

  it("falls back to bounded estimates when provider usage is absent or invalid", () => {
    const huge = user("x".repeat(100_000));
    const accounting = accountTranscriptTokens([
      { role: "assistant", content: "bad usage", timestamp: 0, usage: { totalTokens: -1 } } as unknown as AgentMessage,
      huge,
    ]);

    expect(accounting).toMatchObject({ exact: false, source: "estimated" });
    expect(estimateMessageTokens(huge)).toBe(8192);
    expect(accounting.tokens).toBeLessThanOrEqual(8192 + 5);
  });

  it("also exposes an unbounded estimate for compaction planning", () => {
    expect(estimateMessageTokensUnbounded(user("x".repeat(40_000)))).toBe(20_000);
  });
});

describe("final request budget allocation", () => {
  it("reserves output capacity and returns remaining node-local tail budget", () => {
    const allocation = allocateFinalRequestBudget({
      contextWindowTokens: 100_000,
      reserveTokens: 16_000,
      systemTokens: { tokens: 5_000, exact: true },
      frozenBranchTokens: { tokens: 20_000, exact: true },
      seedTokens: { tokens: 500, exact: true },
      dynamicTailAllowanceTokens: 2_000,
      pendingUserInputTokens: { tokens: 750, exact: false },
      checkpointSummaryAllowanceTokens: 4_000,
    });

    expect(allocation).toMatchObject({
      status: "ok",
      safeInputBudget: 84_000,
      fixedContextTokens: 32_250,
      nodeLocalTailBudget: 51_750,
      exact: false,
    });
  });

  it("reports fixed-context overflow instead of silently dropping required context", () => {
    const allocation = allocateFinalRequestBudget({
      contextWindowTokens: 10_000,
      reserveTokens: 2_000,
      systemTokens: { tokens: 4_000, exact: true },
      frozenBranchTokens: { tokens: 4_500, exact: true },
      seedTokens: { tokens: 100, exact: true },
      dynamicTailAllowanceTokens: 0,
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryAllowanceTokens: 0,
    });

    expect(allocation).toMatchObject({
      status: "fixed-context-overflow",
      safeInputBudget: 8_000,
      fixedContextTokens: 8_600,
      nodeLocalTailBudget: 0,
      overflowTokens: 600,
    });
  });
});

describe("model-aware context budget", () => {
  const model = { providerId: "openai", modelId: "small", contextWindowTokens: 1_000, maxOutputTokens: 200 };

  it("uses model output capacity and fixed context to derive the local tail", () => {
    const allocation = allocateContextBudget({
      model,
      safetyMarginTokens: 50,
      systemTokens: { tokens: 100, exact: false },
      toolTokens: { tokens: 50, exact: false },
      frozenBranchTokens: { tokens: 100, exact: true },
      seedTokens: { tokens: 20, exact: true },
      pendingUserInputTokens: { tokens: 30, exact: false },
      checkpointSummaryTokens: { tokens: 40, exact: false },
      projectedMessages: [user("x".repeat(2_000))],
    });

    expect(allocation).toMatchObject({
      status: "needs-compaction",
      safeInputBudget: 800,
      fixedContextTokens: 340,
      nodeLocalTailBudget: 460,
      attachmentBudgetTokens: 0,
      model,
      source: "estimated",
    });
  });

  it("derives attachment capacity independently from the source tail allowance", () => {
    const allocation = allocateContextBudget({
      model: { providerId: "openai", modelId: "large", contextWindowTokens: 20_000, maxOutputTokens: 1_000 },
      systemTokens: { tokens: 100, exact: true },
      toolTokens: { tokens: 100, exact: true },
      frozenBranchTokens: { tokens: 0, exact: true },
      seedTokens: { tokens: 0, exact: true },
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryTokens: { tokens: 15_000, exact: false },
      projectedMessages: [],
    });

    expect(allocation.nodeLocalTailBudget).toBe(3_800);
    expect(allocation.attachmentBudgetTokens).toBe(12_000);
  });

  it("reports fixed context overflow without producing a negative tail", () => {
    const allocation = allocateContextBudget({
      model,
      systemTokens: { tokens: 700, exact: true },
      toolTokens: { tokens: 100, exact: true },
      frozenBranchTokens: { tokens: 100, exact: true },
      seedTokens: { tokens: 10, exact: true },
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryTokens: { tokens: 0, exact: true },
      projectedMessages: [],
    });

    expect(allocation).toMatchObject({ status: "fixed-context-overflow", overflowTokens: 110, nodeLocalTailBudget: 0 });
  });

  it("marks missing model metadata unavailable", () => {
    const allocation = allocateContextBudget({
      model: { providerId: "local", modelId: "unknown", contextWindowTokens: 0, maxOutputTokens: 0 },
      systemTokens: { tokens: 1, exact: false },
      toolTokens: { tokens: 0, exact: true },
      frozenBranchTokens: { tokens: 0, exact: true },
      seedTokens: { tokens: 0, exact: true },
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryTokens: { tokens: 0, exact: true },
      projectedMessages: [],
    });

    expect(allocation).toMatchObject({ status: "model-unavailable", source: "estimated" });
  });

  it("preserves mixed accounting when a provider baseline has later estimated messages", () => {
    const allocation = allocateContextBudget({
      model: { providerId: "openai", modelId: "large", contextWindowTokens: 10_000, maxOutputTokens: 500 },
      systemTokens: { tokens: 10, exact: true },
      toolTokens: { tokens: 0, exact: true },
      frozenBranchTokens: { tokens: 0, exact: true },
      seedTokens: { tokens: 0, exact: true },
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryTokens: { tokens: 0, exact: true },
      projectedMessages: [
        { role: "assistant", content: "answer", timestamp: 0, usage: { totalTokens: 100 } } as unknown as AgentMessage,
        user("later"),
      ],
    });

    expect(allocation.source).toBe("mixed");
    expect(allocation.transcript.providerTokens).toBe(100);
  });

  it("does not double-count fixed transcript messages in an estimated request", () => {
    const allocation = allocateContextBudget({
      model: { providerId: "local", modelId: "tiny", contextWindowTokens: 10_000, maxOutputTokens: 500 },
      systemTokens: { tokens: 10, exact: false },
      toolTokens: { tokens: 0, exact: true },
      frozenBranchTokens: { tokens: 100, exact: false },
      seedTokens: { tokens: 0, exact: true },
      pendingUserInputTokens: { tokens: 0, exact: true },
      checkpointSummaryTokens: { tokens: 0, exact: true },
      projectedMessages: [user("f".repeat(200)), user("t".repeat(400))],
    });

    expect(allocation.transcript.tokens).toBe(300);
    expect(allocation.projectedInputTokens).toBe(310);
  });
});
