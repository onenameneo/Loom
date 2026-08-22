import { describe, expect, it } from "vitest";
import { appendAssistantDeltaToSnapshot, beginTurnSnapshot } from "./liveTurns";
import { createNodeRuntimeStore } from "./nodeRuntime";

describe("NodeRuntime live-turn publication", () => {
  it("publishes a patch instead of a cumulative snapshot for content updates", () => {
    const events: unknown[] = [];
    const store = createNodeRuntimeStore({ publishLive: (event) => events.push(event) });
    const initial = beginTurnSnapshot({ nodeId: "n1", sessionId: "s1", turnId: "t1", operation: "send" });
    store.set("n1", { node: {} as never, pendingSkillIds: [], liveSnapshot: undefined });

    store.transition("n1", () => ({ liveSnapshot: initial }));
    store.transition("n1", (current) => ({
      liveSnapshot: current.liveSnapshot ? appendAssistantDeltaToSnapshot(current.liveSnapshot, "hello") : undefined,
    }));

    expect(events[0]).toMatchObject({ type: "upsert", snapshot: { revision: 1 } });
    expect(events[1]).toMatchObject({ type: "patch", revision: 2, parts: [{ delta: "hello" }] });
  });
});
