import { beforeEach, describe, expect, it } from "vitest";
import type { ApprovalRequestPayload, LiveTurnSnapshot, ProjectMeta, SessionMeta } from "../env";
import {
  resetWorkspaceStore,
  selectNodesForSession,
  selectRunningNodeCount,
  useWorkspaceStore,
} from "./store";

const project = (id: string): ProjectMeta => ({ id, name: id, createdAt: 1, updatedAt: 1, pinned: false, order: 0 });
const session = (id: string, projectId: string): SessionMeta => ({ id, projectId, title: id, createdAt: 1, updatedAt: 1, order: 0 });
const turn = (overrides: Partial<LiveTurnSnapshot> = {}): LiveTurnSnapshot => ({
  nodeId: "node-a",
  sessionId: "session-a",
  turnId: "turn-a",
  operation: "send",
  state: "running",
  revision: 1,
  assistantText: "",
  ...overrides,
});
const approval = (requestId: string, revision: number): ApprovalRequestPayload => ({
  requestId, nodeId: "node-a", turnId: "turn-a", toolCallId: requestId, toolName: "write", target: "src/a.ts",
  preview: { title: "Write src/a.ts" }, defaultScope: "once", createdAt: 1, expiresAt: 100, revision,
});

describe("workspace store", () => {
  beforeEach(() => resetWorkspaceStore());

  it("does not select a default Project or Session while hydrating the app", () => {
    const store = useWorkspaceStore.getState();
    store.hydrateProjects([{ ...project("project-a"), ui: { activeSessionId: "session-a" } }]);
    store.hydrateSessions("project-a", [session("session-a", "project-a")]);

    expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
    expect(useWorkspaceStore.getState().activeSessionId).toBeNull();
    expect(useWorkspaceStore.getState().activeNodeId).toBeNull();
  });

  it("keeps Node A's turn unchanged when navigation selects Session B", () => {
    const store = useWorkspaceStore.getState();
    store.applyLiveTurn({ type: "upsert", snapshot: turn() });
    store.selectSession("session-b");

    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.sessionId).toBe("session-a");
    expect(useWorkspaceStore.getState().activeSessionId).toBe("session-b");
  });

  it("rejects an older snapshot after a newer revision", () => {
    const store = useWorkspaceStore.getState();
    store.applyLiveTurn({ type: "upsert", snapshot: turn({ revision: 3, assistantText: "new" }) });
    store.applyLiveTurn({ type: "upsert", snapshot: turn({ revision: 2, assistantText: "old" }) });

    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.revision).toBe(3);
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.assistantText).toBe("new");
  });

  it("keeps another Session's Node relation while one Session refreshes", () => {
    const store = useWorkspaceStore.getState();
    store.hydrateProjects([project("project-a"), project("project-b")]);
    store.hydrateSessions("project-a", [session("session-a", "project-a")]);
    store.hydrateSessions("project-b", [session("session-b", "project-b")]);
    store.hydrateNodes("session-a", [{ id: "node-a", projectId: "project-a", sessionId: "session-a", title: "A", messages: [] }]);
    store.hydrateNodes("session-b", [{ id: "node-b", projectId: "project-b", sessionId: "session-b", title: "B", messages: [] }]);

    store.hydrateNodes("session-a", [{ id: "node-a", projectId: "project-a", sessionId: "session-a", title: "A refreshed", messages: [] }]);

    expect(selectNodesForSession(useWorkspaceStore.getState(), "session-a").map((node) => node.title)).toEqual(["A refreshed"]);
    expect(selectNodesForSession(useWorkspaceStore.getState(), "session-b").map((node) => node.id)).toEqual(["node-b"]);
  });

  it("patches a Node without replacing its Session relation", () => {
    const store = useWorkspaceStore.getState();
    store.hydrateNodes("session-a", [{ id: "node-a", projectId: "project-a", sessionId: "session-a", title: "Before", messages: [] }]);

    store.patchNode("node-a", { title: "After", color: "blue" });

    expect(selectNodesForSession(useWorkspaceStore.getState(), "session-a")).toMatchObject([
      { id: "node-a", title: "After", color: "blue" },
    ]);
  });

  it("derives a Session running count without storing one", () => {
    const store = useWorkspaceStore.getState();
    store.applyLiveTurn({ type: "upsert", snapshot: turn() });
    store.applyLiveTurn({ type: "upsert", snapshot: turn({ nodeId: "node-a-child", revision: 1 }) });

    expect(selectRunningNodeCount(useWorkspaceStore.getState(), "session-a")).toBe(2);
    expect("liveTurnCounts" in useWorkspaceStore.getState()).toBe(false);
  });

  it("replays pending approvals and rejects stale updates", () => {
    const store = useWorkspaceStore.getState();
    store.hydrateApprovals([approval("r1", 1)]);
    store.applyApproval({ type: "remove", requestId: "r1", revision: 2 });
    store.applyApproval({ type: "upsert", request: approval("r1", 1) });

    expect(useWorkspaceStore.getState().approvalsById.r1).toBeUndefined();
    expect(useWorkspaceStore.getState().latestApprovalRevision).toBe(2);
  });

  it("keeps an approval visible when the active node changes", () => {
    const store = useWorkspaceStore.getState();
    store.hydrateApprovals([approval("r1", 1)]);
    store.selectNode("node-b");

    expect(useWorkspaceStore.getState().approvalsById.r1?.nodeId).toBe("node-a");
  });
});
