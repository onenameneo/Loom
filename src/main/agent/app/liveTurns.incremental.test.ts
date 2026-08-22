import { describe, expect, it } from "vitest";
import {
  appendAssistantDeltaToSnapshot,
  appendAssistantThinkingToSnapshot,
  beginTurnSnapshot,
  createLiveTurnEvent,
} from "./liveTurns";

describe("incremental live-turn content", () => {
  it("keeps thinking and text in arrival order while retaining legacy fields", () => {
    let snapshot = beginTurnSnapshot({ nodeId: "node-1", sessionId: "session-1", turnId: "turn-1", operation: "send" });
    snapshot = appendAssistantThinkingToSnapshot(snapshot, "plan");
    snapshot = appendAssistantDeltaToSnapshot(snapshot, "answer");
    snapshot = appendAssistantThinkingToSnapshot(snapshot, "check");

    expect(snapshot.contentParts?.map((part) => [part.kind, part.text])).toEqual([
      ["thinking", "plan"],
      ["text", "answer"],
      ["thinking", "check"],
    ]);
    expect(snapshot.assistantThinking).toBe("plancheck");
    expect(snapshot.assistantText).toBe("answer");
  });

  it("publishes only the new part delta for a cumulative snapshot transition", () => {
    let previous = beginTurnSnapshot({ nodeId: "node-1", sessionId: "session-1", turnId: "turn-1", operation: "send" });
    previous = appendAssistantDeltaToSnapshot(previous, "hello");
    const next = appendAssistantDeltaToSnapshot(previous, " world");

    expect(createLiveTurnEvent(previous, next, 2)).toEqual(expect.objectContaining({
      type: "patch",
      revision: 2,
      sequence: 2,
      parts: [{ partId: expect.any(String), kind: "text", delta: " world", sequence: 1 }],
    }));
  });

  it("uses replace when a part is rewritten instead of silently dropping text", () => {
    let previous = beginTurnSnapshot({ nodeId: "node-1", sessionId: "session-1", turnId: "turn-1", operation: "send" });
    previous = appendAssistantDeltaToSnapshot(previous, "old");
    const rewritten = { ...previous, assistantText: "new", contentParts: [{ ...previous.contentParts![0], text: "new" }] };

    expect(createLiveTurnEvent(previous, rewritten, 2)).toEqual(expect.objectContaining({
      type: "replace",
      revision: 2,
      snapshot: { ...rewritten, revision: 2 },
    }));
  });
});
