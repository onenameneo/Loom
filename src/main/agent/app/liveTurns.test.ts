import { describe, expect, it, vi } from "vitest";
import type { TurnLifecycleEvent } from "../ports";
import {
  appendAssistantDeltaToSnapshot,
  appendAssistantThinkingToSnapshot,
  applyLifecycleToSnapshot,
  beginTurnSnapshot,
  createLiveTurnPublisher,
} from "./liveTurns";

describe("createLiveTurnPublisher", () => {
  it("broadcasts published events to all subscribers and supports unsubscribe", () => {
    const publisher = createLiveTurnPublisher();
    const first = vi.fn();
    const second = vi.fn();
    const stop = publisher.subscribe(first);
    publisher.subscribe(second);

    const snapshot = beginTurnSnapshot({ nodeId: "node-a", sessionId: "session-a", turnId: "turn-a", operation: "send" });
    publisher.publish({ type: "upsert", snapshot: { ...snapshot, revision: 1 } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stop();
    publisher.publish({ type: "remove", nodeId: "node-a", revision: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe("live snapshot pure transforms", () => {
  it("appends assistant deltas", () => {
    const snap = beginTurnSnapshot({ nodeId: "n", sessionId: "s", turnId: "t", operation: "send" });
    const updated = appendAssistantDeltaToSnapshot(snap, "hello");
    expect(updated.assistantText).toBe("hello");
    expect(snap.assistantText).toBe("");
  });

  it("appends assistant thinking separately from visible text", () => {
    const snap = beginTurnSnapshot({ nodeId: "n", sessionId: "s", turnId: "t", operation: "send" });
    const updated = appendAssistantThinkingToSnapshot(snap, "plan");
    expect(updated.assistantThinking).toBe("plan");
    expect(updated.assistantText).toBe("");
  });

  it("maps a non-terminal lifecycle to a snapshot update", () => {
    const snap = beginTurnSnapshot({ nodeId: "n", sessionId: "s", turnId: "t", operation: "send" });
    const event: TurnLifecycleEvent = {
      nodeId: "n",
      turnId: "t",
      operation: "send",
      state: "awaiting_approval",
      approval: { requestId: "r", toolName: "bash", toolCallId: "c", reason: "destructive_command" },
    };
    expect(applyLifecycleToSnapshot(snap, event)).toMatchObject({ state: "awaiting_approval", approval: event.approval });
  });

  it("maps terminal lifecycles to removal (undefined)", () => {
    const snap = beginTurnSnapshot({ nodeId: "n", sessionId: "s", turnId: "t", operation: "send" });
    for (const state of ["completed", "aborted", "failed"] as const) {
      const event: TurnLifecycleEvent = { nodeId: "n", turnId: "t", operation: "send", state };
      expect(applyLifecycleToSnapshot(snap, event)).toBeUndefined();
    }
  });
});
