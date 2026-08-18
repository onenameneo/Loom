import { describe, expect, it } from "vitest";
import { composerBudgetState } from "./contextBudget";

describe("composerBudgetState", () => {
  it("maps projected input to a warning percentage while preserving provenance", () => {
    expect(composerBudgetState({ safeInputBudget: 1_000, projectedInputTokens: 800, status: "needs-compaction", source: "estimated" } as any)).toMatchObject({
      percent: 80,
      progress: 0.8,
      status: "warning",
      source: "estimated",
    });
  });

  it("keeps the visible percentage above 100 while clamping the ring progress", () => {
    expect(composerBudgetState({ safeInputBudget: 1_000, projectedInputTokens: 1_050, status: "ok", source: "mixed" } as any)).toMatchObject({
      percent: 105,
      progress: 1,
      status: "critical",
      source: "mixed",
    });
  });

  it("uses an unavailable state when the model budget cannot be calculated", () => {
    expect(composerBudgetState({ safeInputBudget: 0, status: "model-unavailable" } as any)).toMatchObject({
      percent: null,
      progress: 0,
      status: "model-unavailable",
    });
  });
});
