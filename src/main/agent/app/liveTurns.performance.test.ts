import { describe, expect, it } from "vitest";
import { appendAssistantDeltaToSnapshot, beginTurnSnapshot, createLiveTurnEvent } from "./liveTurns";

describe("live-turn streaming payload benchmark", () => {
  it("keeps patch payload bounded as the accumulated reply grows", () => {
    const sizes: Array<{ reply: number; patch: number }> = [];
    for (const replySize of [1_024, 10_240, 100_000]) {
      const previous = appendAssistantDeltaToSnapshot(
        beginTurnSnapshot({ nodeId: "node-1", sessionId: "session-1", turnId: "turn-1", operation: "send" }),
        "x".repeat(replySize - 1),
      );
      const next = appendAssistantDeltaToSnapshot(previous, "y");
      const event = createLiveTurnEvent(previous, next, replySize);
      sizes.push({ reply: JSON.stringify(next).length, patch: JSON.stringify(event).length });
    }

    expect(sizes[2]?.reply).toBeGreaterThan(sizes[0]?.reply ?? 0);
    expect(Math.max(...sizes.map((item) => item.patch))).toBeLessThan(700);
    expect(sizes[2]?.patch).toBeLessThan((sizes[2]?.reply ?? 0) / 100);
  });
});
