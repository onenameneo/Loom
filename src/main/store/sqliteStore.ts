import { mkdirSync } from "fs";
import { dirname, join } from "path";
import Database from "better-sqlite3";
import { importLegacyJsonIfEmpty, migrate } from "./migrations";
import {
  DEFAULT_SETTINGS,
  type NodeRecord,
  type PersistedMessage,
  type Settings,
  type Store,
  type Workspace,
} from "./store";

type WorkspaceRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  order: number;
};

type NodeRow = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  seed: string | null;
  mount_ancestors: number;
  meta: string | null;
};

type MessageRow = {
  id: string;
  seq: number;
  role: string;
  content: string;
  meta: string | null;
};

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function encode(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decode<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: Boolean(row.pinned),
    order: row.order,
  };
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    migrate(this.db);
    importLegacyJsonIfEmpty(this.db, dirname(file));
  }

  getSettings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      access: decode(values.get("access"), DEFAULT_SETTINGS.access),
      appearance: decode(values.get("appearance"), DEFAULT_SETTINGS.appearance),
      apiKeyEnc: decode<string | undefined>(values.get("apiKeyEnc"), undefined),
    };
  }

  patchSettings(patch: Partial<Omit<Settings, "apiKeyEnc">>): Settings {
    const current = this.getSettings();
    const next: Settings = {
      ...current,
      access: { ...current.access, ...(patch.access ?? {}) },
      appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    };
    const stmt = this.db.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const tx = this.db.transaction(() => {
      stmt.run("access", encode(next.access));
      stmt.run("appearance", encode(next.appearance));
    });
    tx();
    return next;
  }

  getApiKeyEnc(): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get("apiKeyEnc") as
      | { value: string }
      | undefined;
    return decode<string | undefined>(row?.value, undefined);
  }

  setApiKeyEnc(enc: string | undefined): void {
    if (!enc) {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run("apiKeyEnc");
      return;
    }
    this.db
      .prepare(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("apiKeyEnc", encode(enc));
  }

  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at, pinned, "order" FROM workspaces')
      .all() as WorkspaceRow[];
    return rows
      .map(toWorkspace)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.updatedAt - a.updatedAt,
      );
  }

  createWorkspace(name = "未命名会话"): Workspace {
    const now = Date.now();
    const ws: Workspace = {
      id: id("ws"),
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: Number(
        (this.db.prepare("SELECT COUNT(*) AS count FROM workspaces").get() as { count: number } | undefined)
          ?.count ?? 0,
      ),
    };
    this.db
      .prepare(
        'INSERT INTO workspaces(id, name, created_at, updated_at, pinned, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ws.id, ws.name, ws.createdAt, ws.updatedAt, 0, ws.order, encode({}));
    return ws;
  }

  renameWorkspace(id: string, name: string): void {
    this.db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  }

  setPinned(id: string, pinned: boolean): void {
    this.db
      .prepare("UPDATE workspaces SET pinned = ?, updated_at = ? WHERE id = ?")
      .run(pinned ? 1 : 0, Date.now(), id);
  }

  listNodes(workspaceId: string): NodeRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, workspace_id, parent_id, title, seed, mount_ancestors, meta FROM nodes WHERE workspace_id = ? ORDER BY created_at, id",
      )
      .all(workspaceId) as NodeRow[];
    return rows.map((row) => this.toNode(row));
  }

  getNode(id: string): NodeRecord | undefined {
    const row = this.db
      .prepare("SELECT id, workspace_id, parent_id, title, seed, mount_ancestors, meta FROM nodes WHERE id = ?")
      .get(id) as NodeRow | undefined;
    return row ? this.toNode(row) : undefined;
  }

  createNode(input: {
    workspaceId: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
  }): NodeRecord {
    const now = Date.now();
    const node: NodeRecord = {
      id: id("n"),
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      title: input.title,
      seed: input.seed,
      mountAncestors: Boolean(input.mountAncestors),
      messages: [],
    };
    this.db
      .prepare(
        `INSERT INTO nodes(
          id, workspace_id, parent_id, title, seed, mount_ancestors, created_at, updated_at, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.workspaceId,
        node.parentId ?? null,
        node.title,
        node.seed === undefined ? null : encode(node.seed),
        node.mountAncestors ? 1 : 0,
        now,
        now,
        encode({}),
      );
    return node;
  }

  updateNode(
    id: string,
    patch: Partial<{ title: string; mountAncestors: boolean; seed: unknown; systemPrompt: string; model: string; color: string }>,
  ): void {
    const current = this.getNode(id);
    if (!current) return;
    const row = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as
      | { meta: string | null }
      | undefined;
    const meta = decode<Record<string, unknown>>(row?.meta, {});
    if (Object.prototype.hasOwnProperty.call(patch, "systemPrompt")) {
      const text = patch.systemPrompt?.trim() ?? "";
      if (text) meta.systemPrompt = text;
      else delete meta.systemPrompt;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "model")) {
      const model = patch.model?.trim() ?? "";
      if (model) meta.model = model;
      else delete meta.model;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "color")) {
      const color = patch.color?.trim() ?? "";
      if (color) meta.color = color;
      else delete meta.color;
    }
    this.db
      .prepare("UPDATE nodes SET title = ?, seed = ?, mount_ancestors = ?, meta = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.title ?? current.title,
        Object.prototype.hasOwnProperty.call(patch, "seed") ? encode(patch.seed) : encode(current.seed),
        patch.mountAncestors ?? current.mountAncestors ? 1 : 0,
        encode(meta),
        Date.now(),
        id,
      );
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  appendMessages(nodeId: string, msgs: PersistedMessage[]): void {
    if (msgs.length === 0) return;
    const maxSeqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), -1) AS seq FROM messages WHERE node_id = ?");
    const insert = this.db.prepare(`
      INSERT INTO messages(id, node_id, seq, role, content, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const touch = this.db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?");
    const tx = this.db.transaction((messages: PersistedMessage[]) => {
      let seq = Number((maxSeqStmt.get(nodeId) as { seq: number }).seq) + 1;
      const now = Date.now();
      for (const msg of messages) {
        insert.run(
          msg.id || id("msg"),
          nodeId,
          seq++,
          msg.role,
          encode(msg.content),
          msg.meta === undefined ? null : encode(msg.meta),
          now,
        );
      }
      touch.run(now, nodeId);
    });
    tx(msgs);
  }

  deleteMessagesFrom(nodeId: string, seq: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE node_id = ? AND seq >= ?").run(nodeId, seq);
      this.db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run(Date.now(), nodeId);
    });
    tx();
  }

  listMessages(nodeId: string): PersistedMessage[] {
    const rows = this.db
      .prepare("SELECT id, seq, role, content, meta FROM messages WHERE node_id = ? ORDER BY seq")
      .all(nodeId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      role: row.role,
      content: decode(row.content, { role: row.role, content: "", timestamp: Date.now() } as PersistedMessage["content"]),
      meta: decode(row.meta, undefined),
    }));
  }

  private toNode(row: NodeRow): NodeRecord {
    const meta = decode<Record<string, unknown>>(row.meta, {});
    const systemPrompt = typeof meta.systemPrompt === "string" ? meta.systemPrompt : undefined;
    const model = typeof meta.model === "string" ? meta.model : undefined;
    const color = typeof meta.color === "string" ? meta.color : undefined;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      parentId: row.parent_id ?? undefined,
      title: row.title,
      seed: decode(row.seed, undefined),
      systemPrompt,
      model,
      color,
      mountAncestors: Boolean(row.mount_ancestors),
      messages: this.listMessages(row.id),
    };
  }
}

export function dbPath(userDataDir: string): string {
  return join(userDataDir, "loom.db");
}
