import { describe, expect, it } from "vitest";
import { createLiveTurnStore } from "./liveTurns";

describe("createLiveTurnStore", () => {
  it("assigns monotonically increasing revisions per Node", () => {
    const turns = createLiveTurnStore();

    const first = turns.beginTurn({ nodeId: "node-a", sessionId: "session-a", turnId: "turn-a", operation: "send" });
    const second = turns.beginTurn({ nodeId: "node-b", sessionId: "session-a", turnId: "turn-b", operation: "send" });
    const updated = turns.appendAssistantDelta("node-a", "hello");

    expect(first?.revision).toBe(1);
    expect(second?.revision).toBe(1);
    expect(updated).toMatchObject({ revision: 2, assistantText: "hello" });
    expect(turns.list()).toHaveLength(2);
  });

  it("emits a newer removal revision and does not resurrect a cleared turn from a late delta", () => {
    const turns = createLiveTurnStore();
    const events: unknown[] = [];
    turns.subscribe((event) => events.push(event));

    turns.beginTurn({ nodeId: "node-a", sessionId: "session-a", turnId: "turn-a", operation: "send" });
    const removed = turns.invalidateNode("node-a");

    expect(removed).toEqual({ type: "remove", nodeId: "node-a", revision: 2 });
    expect(turns.appendAssistantDelta("node-a", "late")).toBeUndefined();
    expect(turns.list()).toEqual([]);
    expect(events).toContainEqual({ type: "remove", nodeId: "node-a", revision: 2 });
  });
});
