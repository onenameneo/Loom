import type Database from "better-sqlite3";

export const DB_SCHEMA_VERSION = 6;

const CANONICAL_TABLES = [
  "settings",
  "projects",
  "sessions",
  "nodes",
  "messages",
  "approval_policies",
] as const;

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function nodeColumns(db: Database.Database): string[] {
  if (!tableExists(db, "nodes")) return [];
  return (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map((column) => column.name);
}

function isCanonical(db: Database.Database): boolean {
  const version = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const columns = nodeColumns(db);
  return (
    version >= 5 &&
    tableExists(db, "projects") &&
    tableExists(db, "sessions") &&
    tableExists(db, "nodes") &&
    columns.includes("project_id") &&
    !columns.includes("workspace_id")
  );
}

function resetLoomTables(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  for (const table of CANONICAL_TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec("DROP TABLE IF EXISTS workspaces");
  db.pragma("foreign_keys = ON");
}

function createCanonicalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      pinned INTEGER,
      "order" INTEGER,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions(
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      "order" INTEGER,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS nodes(
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS messages(
      id TEXT PRIMARY KEY,
      node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      seq INTEGER,
      role TEXT,
      content TEXT,
      meta TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS approval_policies(
      tool_name TEXT NOT NULL,
      target TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(tool_name, target)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, "order");
    CREATE INDEX IF NOT EXISTS idx_nodes_project_session ON nodes(project_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_msg_node ON messages(node_id, seq);
    PRAGMA user_version = ${DB_SCHEMA_VERSION};
  `);
}

export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const version = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (version !== 0 && !isCanonical(db)) {
    const reset = db.transaction(() => {
      resetLoomTables(db);
      createCanonicalSchema(db);
    });
    reset();
    db.pragma("foreign_keys = ON");
    return;
  }

  createCanonicalSchema(db);
  // Canonical databases can be upgraded in place because settings are
  // key/value rows; preserve existing projects, sessions, nodes and approvals.
  if (isCanonical(db)) db.pragma(`user_version = ${DB_SCHEMA_VERSION}`);
  db.pragma("foreign_keys = ON");
}
