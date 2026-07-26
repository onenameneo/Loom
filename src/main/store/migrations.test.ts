import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";

describe("database migrations", () => {
  it("upgrades to schema v4 with sessions, node ownership, layouts, and approval policies", () => {
    const db = new Database(":memory:");
    migrate(db);

    const version = Number(db.pragma("user_version", { simple: true }));
    const columns = (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    const approvalColumns = (db.prepare("PRAGMA table_info(approval_policies)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    const sessionColumns = (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    expect(version).toBe(4);
    expect(columns).toEqual(
      expect.arrayContaining(["session_id", "layout_x", "layout_y", "layout_width", "layout_height"]),
    );
    expect(sessionColumns).toEqual(expect.arrayContaining(["project_id", "title", "order"]));
    expect(approvalColumns).toEqual(expect.arrayContaining(["tool_name", "target", "created_at"]));
  });

  it("creates one default session per legacy workspace without changing node or message identity", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE workspaces(
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        pinned INTEGER,
        "order" INTEGER,
        meta TEXT
      );
      CREATE TABLE nodes(
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
        title TEXT,
        seed TEXT,
        mount_ancestors INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        meta TEXT,
        layout_x REAL,
        layout_y REAL,
        layout_width REAL,
        layout_height REAL
      );
      CREATE TABLE messages(
        id TEXT PRIMARY KEY,
        node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
        seq INTEGER,
        role TEXT,
        content TEXT,
        meta TEXT,
        created_at INTEGER
      );
      CREATE TABLE approval_policies(tool_name TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tool_name, target));
      PRAGMA user_version = 3;
    `);
    db.prepare('INSERT INTO workspaces(id, name, created_at, updated_at, pinned, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      "ws1",
      "Legacy Project",
      10,
      11,
      0,
      0,
      "{}",
    );
    db.prepare("INSERT INTO nodes(id, workspace_id, parent_id, title, seed, mount_ancestors, created_at, updated_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "n-root",
      "ws1",
      null,
      "Root",
      null,
      0,
      12,
      13,
      "{}",
    );
    db.prepare("INSERT INTO messages(id, node_id, seq, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "m-root",
      "n-root",
      0,
      "user",
      JSON.stringify({ role: "user", content: "hello" }),
      null,
      14,
    );

    migrate(db);

    const session = db.prepare("SELECT id, project_id, title FROM sessions WHERE project_id = ?").get("ws1") as {
      id: string;
      project_id: string;
      title: string;
    };
    const node = db.prepare("SELECT id, workspace_id, session_id FROM nodes WHERE id = ?").get("n-root") as {
      id: string;
      workspace_id: string;
      session_id: string;
    };
    const message = db.prepare("SELECT id, node_id FROM messages WHERE id = ?").get("m-root") as { id: string; node_id: string };

    expect(session).toMatchObject({ id: "sess_ws1", project_id: "ws1", title: "默认会话" });
    expect(node).toEqual({ id: "n-root", workspace_id: "ws1", session_id: "sess_ws1" });
    expect(message).toEqual({ id: "m-root", node_id: "n-root" });
  });
});
