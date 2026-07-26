import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./sqliteStore";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStore node layouts", () => {
  it("keeps node graphs isolated by session inside one project", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-session-scope-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createWorkspace("Project");
    const firstSession = store.ensureDefaultSession(project.id);
    const secondSession = store.createSession(project.id, "Second");
    const first = store.createNode({ sessionId: firstSession.id, title: "First root" });
    const second = store.createNode({ sessionId: secondSession.id, title: "Second root" });

    expect(store.listNodes(firstSession.id).map((node) => node.id)).toEqual([first.id]);
    expect(store.listNodes(secondSession.id).map((node) => node.id)).toEqual([second.id]);
    expect(first.workspaceId).toBe(project.id);
    expect(second.workspaceId).toBe(project.id);
  });

  it("cascades nodes and messages when deleting a session", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-session-cascade-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createWorkspace("Project");
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
    const workspace = store.createWorkspace("Layout test");
    const node = store.createNode({ workspaceId: workspace.id, title: "Root" });
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
    const workspace = store.createWorkspace("Layout write");
    const node = store.createNode({ workspaceId: workspace.id, title: "Root" });
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
    const workspace = store.createWorkspace("Layout batch");
    const first = store.createNode({ workspaceId: workspace.id, title: "First" });
    const second = store.createNode({ workspaceId: workspace.id, title: "Second" });
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
