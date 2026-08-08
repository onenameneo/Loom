import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./sqliteStore";
import { createLoomContextCheckpoint, createLoomFrozenBranchSummary } from "../agent/core/messages";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStore node layouts", () => {
  it("persists a session's last open node and preferred view mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-session-ui-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const session = store.ensureDefaultSession(project.id);
    const node = store.createNode({ sessionId: session.id, title: "Root" });

    store.updateSessionUi(session.id, { activeNodeId: node.id, mode: "chat" });

    expect(store.getSession(session.id)?.ui).toEqual({ activeNodeId: node.id, mode: "chat" });
  });

  it("persists a project's most recently opened session", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-project-ui-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const session = store.ensureDefaultSession(project.id);

    store.updateProjectUi(project.id, { activeSessionId: session.id });

    expect(store.listProjects()[0]?.ui).toEqual({ activeSessionId: session.id });
  });

  it("persists default and manual title state for sessions and nodes", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-title-state-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const session = store.ensureDefaultSession(project.id);
    expect(session.title).toBe("新会话");
    expect(session.titleState).toBe("default");

    store.renameSession(session.id, "用户标题", { titleState: "manual" });
    expect(store.getSession(session.id)?.titleState).toBe("manual");

    const node = store.createNode({ sessionId: session.id, title: "起点", titleState: "default" });
    expect(store.getNode(node.id)?.titleState).toBe("default");
    store.updateNode(node.id, { title: "手动节点", titleState: "manual" });
    expect(store.getNode(node.id)?.titleState).toBe("manual");
  });

  it("keeps node graphs isolated by session inside one project", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-session-scope-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const firstSession = store.ensureDefaultSession(project.id);
    const secondSession = store.createSession(project.id, "Second");
    const first = store.createNode({ sessionId: firstSession.id, title: "First root" });
    const second = store.createNode({ sessionId: secondSession.id, title: "Second root" });

    expect(store.listNodes(firstSession.id).map((node) => node.id)).toEqual([first.id]);
    expect(store.listNodes(secondSession.id).map((node) => node.id)).toEqual([second.id]);
    expect(first.projectId).toBe(project.id);
    expect(second.projectId).toBe(project.id);
    expect(first).not.toHaveProperty("workspaceId");
    expect(second).not.toHaveProperty("workspaceId");
  });

  it("creates Projects with canonical sourceRoots", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-project-sourceroots-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));

    const project = store.createProject({
      name: "Project",
      sourceRoots: ["/repo/app", "/repo/app", " ", "/repo/tools"],
    });

    expect(project).toMatchObject({
      name: "Project",
      sourceRoots: ["/repo/app", "/repo/tools"],
    });
    expect(project).not.toHaveProperty("sourceFolders");
  });

  it("reopens canonical Projects, Sessions, Nodes, messages, and layouts without resetting them", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-canonical-reopen-"));
    dirs.push(dir);
    const file = join(dir, "loom.db");
    const firstStore = new SqliteStore(file);
    const project = firstStore.createProject({ name: "Project", sourceRoots: ["/repo/app"] });
    const session = firstStore.ensureDefaultSession(project.id);
    const node = firstStore.createNode({ sessionId: session.id, title: "Root" });
    const layout = { x: 30, y: 45, width: 380, height: 280 };
    firstStore.appendMessages(node.id, [
      { id: "m1", seq: 0, role: "user", content: { role: "user", content: "hello" } as any },
    ]);
    firstStore.updateNodeLayout(node.id, layout);
    (firstStore as any).db.close();

    const reopened = new SqliteStore(file);

    expect(reopened.listProjects().map((item) => item.id)).toEqual([project.id]);
    expect(reopened.listSessions(project.id).map((item) => item.id)).toEqual([session.id]);
    expect(reopened.listNodes(session.id).map((item) => item.id)).toEqual([node.id]);
    expect(reopened.getNode(node.id)).toMatchObject({ projectId: project.id, sessionId: session.id, layout });
    expect(reopened.getNode(node.id)).not.toHaveProperty("workspaceId");
    expect(reopened.listMessages(node.id).map((item) => item.id)).toEqual(["m1"]);
  });

  it("reopens derived context checkpoint messages without requiring a schema migration", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-checkpoint-reopen-"));
    dirs.push(dir);
    const file = join(dir, "loom.db");
    const firstStore = new SqliteStore(file);
    const project = firstStore.createProject("Project");
    const session = firstStore.ensureDefaultSession(project.id);
    const node = firstStore.createNode({ sessionId: session.id, title: "Root" });
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: node.id,
      createdAt: 10,
      reason: "threshold",
      summary: "Checkpoint summary.",
      coverage: { fromSeq: 0, toSeq: 1 },
      retainedTail: { fromSeq: 2, toSeq: 2 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 40, exact: false } },
    }) as any;
    firstStore.appendMessages(node.id, [{ id: "cp-1", seq: 0, role: "loomContextCheckpoint", content: checkpoint }]);
    (firstStore as any).db.close();

    const reopened = new SqliteStore(file);

    expect(reopened.getNode(node.id)?.messages[0]?.content).toMatchObject({
      role: "loomContextCheckpoint",
      version: 1,
      summary: "Checkpoint summary.",
    });
  });

  it("reopens a child-owned frozen context from node metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-frozen-branch-reopen-"));
    dirs.push(dir);
    const file = join(dir, "loom.db");
    const firstStore = new SqliteStore(file);
    const project = firstStore.createProject("Project");
    const session = firstStore.ensureDefaultSession(project.id);
    const child = firstStore.createNode({
      sessionId: session.id,
      parentId: undefined,
      title: "Child",
      frozenContext: { version: 1, messages: [{ role: "user", content: "tail" } as any] },
    });
    (firstStore as any).db.close();

    const reopened = new SqliteStore(file);

    expect(reopened.getNode(child.id)?.frozenContext).toMatchObject({ version: 1 });
  });

  it("cascades nodes and messages when deleting a session", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-session-cascade-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const firstSession = store.ensureDefaultSession(project.id);
    const secondSession = store.createSession(project.id, "Second");
    const first = store.createNode({ sessionId: firstSession.id, title: "First root" });
    const second = store.createNode({ sessionId: secondSession.id, title: "Second root" });
    store.appendMessages(second.id, [{ id: "m1", seq: 0, role: "user", content: { role: "user", content: "hello" } as any }]);

    store.deleteSession(secondSession.id);

    expect(store.getNode(first.id)?.id).toBe(first.id);
    expect(store.getNode(second.id)).toBeUndefined();
    expect(store.listMessages(second.id)).toEqual([]);
  });

  it("returns a layout only when all four persisted values are valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-layout-"));
    dirs.push(dir);
    const file = join(dir, "loom.db");
    const store = new SqliteStore(file);
    const project = store.createProject("Layout test");
    const session = store.ensureDefaultSession(project.id);
    const node = store.createNode({ sessionId: session.id, title: "Root" });
    const db = new Database(file);

    db.prepare(
      "UPDATE nodes SET layout_x = ?, layout_y = ?, layout_width = ?, layout_height = ? WHERE id = ?",
    ).run(12, -8, 420, 360, node.id);
    expect((store.getNode(node.id) as any)?.layout).toEqual({
      x: 12,
      y: -8,
      width: 420,
      height: 360,
    });

    db.prepare("UPDATE nodes SET layout_height = NULL WHERE id = ?").run(node.id);
    expect((store.getNode(node.id) as any)?.layout).toBeUndefined();
    db.close();
  });

  it("persists one node layout and reports whether the node exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-layout-write-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Layout write");
    const session = store.ensureDefaultSession(project.id);
    const node = store.createNode({ sessionId: session.id, title: "Root" });
    const layout = { x: 30, y: 45, width: 380, height: 280 };

    const updated = (store as any).updateNodeLayout?.(node.id, layout);

    expect(updated).toBe(true);
    expect((store.getNode(node.id) as any)?.layout).toEqual(layout);
    expect((store as any).updateNodeLayout?.("missing", layout)).toBe(false);
  });

  it("updates existing layouts in one batch and omits deleted node ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-layout-batch-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Layout batch");
    const session = store.ensureDefaultSession(project.id);
    const first = store.createNode({ sessionId: session.id, title: "First" });
    const second = store.createNode({ sessionId: session.id, title: "Second" });
    const firstLayout = { x: 10, y: 20, width: 360, height: 260 };
    const secondLayout = { x: 500, y: 60, width: 410, height: 300 };

    const updatedIds = store.updateNodeLayouts([
      { id: first.id, layout: firstLayout },
      { id: "deleted", layout: firstLayout },
      { id: second.id, layout: secondLayout },
    ]);

    expect(updatedIds).toEqual([first.id, second.id]);
    expect(store.getNode(first.id)?.layout).toEqual(firstLayout);
    expect(store.getNode(second.id)?.layout).toEqual(secondLayout);
  });
});
