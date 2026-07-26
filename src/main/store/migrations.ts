import { existsSync, mkdirSync, readFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import type Database from "better-sqlite3";
import { DEFAULT_SETTINGS, type StoreData, type Workspace } from "./store";

export const DB_SCHEMA_VERSION = 3;

type SettingRow = { key: string; value: string };

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function readJsonStore(file: string): StoreData | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    return {
      version: Number(raw.version ?? 1),
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
    };
  } catch {
    return undefined;
  }
}

function backupJsonStore(file: string): void {
  const bak = `${file}.bak`;
  if (!existsSync(file)) return;
  if (!existsSync(bak)) {
    renameSync(file, bak);
    return;
  }
  renameSync(file, `${bak}.${Date.now()}`);
}

export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  let version = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings(
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS workspaces(
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        pinned INTEGER,
        "order" INTEGER,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS nodes(
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
        title TEXT,
        seed TEXT,
        mount_ancestors INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        meta TEXT
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

      CREATE INDEX IF NOT EXISTS idx_nodes_ws ON nodes(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_msg_node ON messages(node_id, seq);
      PRAGMA user_version = 1;
    `);
    version = 1;
  }

  if (version < 2) {
    const migrateLayout = db.transaction(() => {
      db.exec(`
        ALTER TABLE nodes ADD COLUMN layout_x REAL;
        ALTER TABLE nodes ADD COLUMN layout_y REAL;
        ALTER TABLE nodes ADD COLUMN layout_width REAL;
        ALTER TABLE nodes ADD COLUMN layout_height REAL;
        PRAGMA user_version = 2;
      `);
    });
    migrateLayout();
    version = 2;
  }

  if (version < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS approval_policies(
        tool_name TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(tool_name, target)
      );
      PRAGMA user_version = 3;
    `);
  }

  db.pragma("foreign_keys = ON");
}

export function importLegacyJsonIfEmpty(db: Database.Database, userDataDir: string): void {
  const hasSettings = Boolean(
    db.prepare("SELECT 1 FROM settings LIMIT 1").get() as SettingRow | undefined,
  );
  const hasWorkspaces = Boolean(db.prepare("SELECT 1 FROM workspaces LIMIT 1").get());
  if (hasSettings || hasWorkspaces) return;

  const file = join(userDataDir, "canvas-data.json");
  const data = readJsonStore(file);
  if (!data) return;

  const insertSetting = db.prepare("INSERT INTO settings(key, value) VALUES (?, ?)");
  const insertWorkspace = db.prepare(`
    INSERT INTO workspaces(id, name, created_at, updated_at, pinned, "order", meta)
    VALUES (@id, @name, @createdAt, @updatedAt, @pinned, @order, @meta)
  `);
  const tx = db.transaction(() => {
    insertSetting.run("access", json(data.settings.access));
    insertSetting.run("appearance", json(data.settings.appearance));
    if (data.settings.apiKeyEnc) insertSetting.run("apiKeyEnc", json(data.settings.apiKeyEnc));
    for (const ws of data.workspaces) {
      const workspace: Workspace = {
        id: String(ws.id),
        name: String(ws.name || "未命名会话"),
        createdAt: Number(ws.createdAt || Date.now()),
        updatedAt: Number(ws.updatedAt || Date.now()),
        pinned: Boolean(ws.pinned),
        order: Number(ws.order || 0),
      };
      insertWorkspace.run({ ...workspace, pinned: workspace.pinned ? 1 : 0, meta: json({}) });
    }
  });
  tx();

  mkdirSync(dirname(file), { recursive: true });
  backupJsonStore(file);
}
