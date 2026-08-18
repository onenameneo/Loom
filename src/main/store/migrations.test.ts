import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";

describe("database migrations", () => {
  it("creates the canonical schema with projects, project-owned nodes, layouts, and approval policies", () => {
    const db = new Database(":memory:");
    migrate(db);

    const version = Number(db.pragma("user_version", { simple: true }));
    const columns = (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    const projectColumns = (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    const approvalColumns = (db.prepare("PRAGMA table_info(approval_policies)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    const sessionColumns = (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    expect(version).toBe(9);
    expect(projectColumns).toEqual(expect.arrayContaining(["id", "name", "order", "meta"]));
    expect(columns).toEqual(
      expect.arrayContaining(["project_id", "session_id", "layout_x", "layout_y", "layout_width", "layout_height"]),
    );
    expect(columns).not.toContain("workspace_id");
    expect(sessionColumns).toEqual(expect.arrayContaining(["project_id", "title", "order"]));
    expect(approvalColumns).toEqual(expect.arrayContaining(["tool_name", "target", "created_at"]));
    const planColumns = (db.prepare("PRAGMA table_info(node_plans)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(planColumns).toEqual(expect.arrayContaining(["node_id", "plan_id", "session_id", "turn_id", "revision", "status", "todos", "updated_at"]));
  });

  it("resets a legacy database once instead of migrating old Loom records", () => {
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

    expect(Number(db.pragma("user_version", { simple: true }))).toBe(9);
    expect(db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM nodes").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM settings").get()).toEqual({ count: 0 });

    db.prepare('INSERT INTO projects(id, name, created_at, updated_at, pinned, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      "proj1",
      "Canonical Project",
      20,
      21,
      0,
      0,
      "{}",
    );

    migrate(db);

    expect(db.prepare("SELECT id FROM projects").all()).toEqual([{ id: "proj1" }]);
  });

  it("upgrades an existing canonical database without deleting records", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare("INSERT INTO projects(id, name, created_at, updated_at, pinned, \"order\", meta) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "existing", "Existing", 1, 2, 0, 0, "{}",
    );
    db.pragma("user_version = 5");

    migrate(db);

    expect(Number(db.pragma("user_version", { simple: true }))).toBe(9);
    expect(db.prepare("SELECT id FROM projects").all()).toEqual([{ id: "existing" }]);
  });
});
