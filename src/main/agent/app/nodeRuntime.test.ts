import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "./session";
import type { TurnLifecycleEvent } from "../ports";
import { createNodeRuntimeStore } from "./nodeRuntime";
import {
  appendAssistantDeltaToSnapshot,
  applyLifecycleToSnapshot,
  beginTurnSnapshot,
} from "./liveTurns";

function node(id: string): CanvasNode {
  return { id, sessionId: "session-a", projectId: "project-a", title: id, messages: [], messageMeta: [] } as CanvasNode;
}

function runningSnapshot(nodeId: string, turnId = "t1") {
  return beginTurnSnapshot({ nodeId, sessionId: "session-a", turnId, operation: "send" });
}

describe("createNodeRuntimeStore", () => {
  it("publishes a revisioned upsert when liveSnapshot changes", () => {
    const publishLive = vi.fn();
    const store = createNodeRuntimeStore({ publishLive });
    store.set("n1", { node: node("n1"), pendingSkillIds: [] });

    store.transition("n1", (r) => ({ liveSnapshot: runningSnapshot("n1") }));

    expect(publishLive).toHaveBeenCalledTimes(1);
    expect(publishLive).toHaveBeenLastCalledWith({
      type: "upsert",
      snapshot: expect.objectContaining({ nodeId: "n1", turnId: "t1", revision: 1 }),
    });

    store.transition("n1", (r) =>
      r.liveSnapshot ? { liveSnapshot: appendAssistantDeltaToSnapshot(r.liveSnapshot, "hi") } : {},
    );

    expect(publishLive).toHaveBeenCalledTimes(2);
    expect(publishLive).toHaveBeenLastCalledWith({
      type: "upsert",
      snapshot: expect.objectContaining({ revision: 2, assistantText: "hi" }),
    });
    expect(store.listLive()).toEqual([
      expect.objectContaining({ nodeId: "n1", revision: 2, assistantText: "hi" }),
    ]);
  });

  it("publishes a removal on terminal lifecycle and refuses resurrection from a late delta", () => {
    const publishLive = vi.fn();
    const store = createNodeRuntimeStore({ publishLive });
    store.set("n1", { node: node("n1"), pendingSkillIds: [] });
    store.transition("n1", (r) => ({ liveSnapshot: runningSnapshot("n1") }));

    const terminal: TurnLifecycleEvent = { nodeId: "n1", turnId: "t1", operation: "send", state: "completed" };
    store.transition("n1", (r) => {
      if (!r.liveSnapshot) return {};
      return { liveSnapshot: applyLifecycleToSnapshot(r.liveSnapshot, terminal) };
    });

    expect(publishLive).toHaveBeenLastCalledWith({ type: "remove", nodeId: "n1", revision: 2 });
    expect(store.listLive()).toEqual([]);

    // 迟到的 delta 不得复活已清理的 turn
    store.transition("n1", (r) =>
      r.liveSnapshot ? { liveSnapshot: appendAssistantDeltaToSnapshot(r.liveSnapshot, "late") } : {},
    );
    expect(publishLive).toHaveBeenCalledTimes(2);
    expect(store.listLive()).toEqual([]);
  });

  it("rejects writes after tombstone (disposed)", () => {
    const publishLive = vi.fn();
    const store = createNodeRuntimeStore({ publishLive });
    store.set("n1", { node: node("n1"), pendingSkillIds: [] });

    store.markDisposed("n1");
    store.transition("n1", (r) => ({ liveSnapshot: runningSnapshot("n1") }));

    expect(publishLive).not.toHaveBeenCalled();
    expect(store.get("n1")?.liveSnapshot).toBeUndefined();
  });

  it("throws when a transition replaces the node object identity, and replaceNode bypasses it", () => {
    const store = createNodeRuntimeStore({ publishLive: vi.fn() });
    const original = node("n1");
    store.set("n1", { node: original, pendingSkillIds: [] });

    expect(() => store.transition("n1", () => ({ node: node("n1") }))).toThrow(/must not replace node object identity/);

    const fresh = node("n1");
    store.replaceNode("n1", fresh);
    expect(store.get("n1")?.node).toBe(fresh);
  });

  it("keeps a patch with no liveSnapshot change silent", () => {
    const publishLive = vi.fn();
    const store = createNodeRuntimeStore({ publishLive });
    store.set("n1", { node: node("n1"), pendingSkillIds: [] });

    store.transition("n1", (r) => ({ pendingSkillIds: ["a"] }));

    expect(publishLive).not.toHaveBeenCalled();
    expect(store.get("n1")?.pendingSkillIds).toEqual(["a"]);
  });
});
