import { describe, expect, it } from "vitest";
import { resetWorkspaceStore, useWorkspaceStore } from "./store";

const snapshot = (revision: number, status: "active" | "completed" | "cleared" = "active") => ({
  planId: "p1", nodeId: "n1", sessionId: "s1", turnId: "t1", revision, status,
  todos: [{ id: "a", content: "First", status: "completed" as const }], updatedAt: revision,
});

describe("todo workspace projection", () => {
  it("gates stale events and retains background nodes", () => {
    resetWorkspaceStore();
    useWorkspaceStore.getState().applyTodoPlan({ nodeId: "n1", sessionId: "s1", turnId: "t1", revision: 2, snapshot: snapshot(2) });
    useWorkspaceStore.getState().applyTodoPlan({ nodeId: "n1", sessionId: "s1", turnId: "t1", revision: 1, snapshot: snapshot(1) });
    expect(useWorkspaceStore.getState().plansByNodeId.n1?.revision).toBe(2);
  });

  it("hydrates only when the snapshot is not older and clears plans", () => {
    resetWorkspaceStore();
    useWorkspaceStore.getState().hydrateTodoPlan("n1", snapshot(3));
    useWorkspaceStore.getState().hydrateTodoPlan("n1", snapshot(2));
    expect(useWorkspaceStore.getState().plansByNodeId.n1?.revision).toBe(3);
    useWorkspaceStore.getState().applyTodoPlan({ nodeId: "n1", sessionId: "s1", turnId: "t2", revision: 4, snapshot: snapshot(4, "cleared") });
    expect(useWorkspaceStore.getState().plansByNodeId.n1).toBeUndefined();
  });
});
