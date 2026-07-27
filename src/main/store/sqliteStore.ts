import { mkdirSync } from "fs";
import { dirname, join } from "path";
import Database from "better-sqlite3";
import { migrate } from "./migrations";
import {
  DEFAULT_SETTINGS,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  isValidNodeLayout,
  type NodeLayout,
  type NodeRecord,
  type PersistedMessage,
  type SessionRecord,
  type Settings,
  type Store,
  type Project,
} from "./store";

type ProjectRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  order: number;
  meta: string | null;
};

type SessionRow = {
  id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  order: number;
};

type NodeRow = {
  id: string;
  session_id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  seed: string | null;
  mount_ancestors: number;
  meta: string | null;
  layout_x: number | null;
  layout_y: number | null;
  layout_width: number | null;
  layout_height: number | null;
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

function toProject(row: ProjectRow): Project {
  const meta = decode<Record<string, unknown>>(row.meta, {});
  const sourceRoots = Array.isArray(meta.sourceRoots)
    ? meta.sourceRoots.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: Boolean(row.pinned),
    order: row.order,
    sourceRoots,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    order: row.order,
  };
}

function toLayout(row: NodeRow): NodeLayout | undefined {
  const layout = {
    x: row.layout_x!,
    y: row.layout_y!,
    width: row.layout_width!,
    height: row.layout_height!,
  };
  return isValidNodeLayout(layout) ? layout : undefined;
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    migrate(this.db);
  }

  getSettings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      access: decode(values.get("access"), DEFAULT_SETTINGS.access),
      appearance: decode(values.get("appearance"), DEFAULT_SETTINGS.appearance),
      monitor: decode(values.get("monitor"), DEFAULT_SETTINGS.monitor),
      activity: decode(values.get("activity"), DEFAULT_SETTINGS.activity),
      apiKeyEnc: decode<string | undefined>(values.get("apiKeyEnc"), undefined),
    };
  }

  patchSettings(patch: Partial<Omit<Settings, "apiKeyEnc">>): Settings {
    const current = this.getSettings();
    const next: Settings = {
      ...current,
      access: { ...current.access, ...(patch.access ?? {}) },
      appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
      monitor: { ...current.monitor, ...(patch.monitor ?? {}) },
      activity: { ...current.activity, ...(patch.activity ?? {}) },
    };
    const stmt = this.db.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const tx = this.db.transaction(() => {
      stmt.run("access", encode(next.access));
      stmt.run("appearance", encode(next.appearance));
      stmt.run("monitor", encode(next.monitor));
      stmt.run("activity", encode(next.activity));
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

  listProjects(): Project[] {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at, pinned, "order", meta FROM projects')
      .all() as ProjectRow[];
    return rows
      .map(toProject)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.updatedAt - a.updatedAt,
      );
  }

  createProject(input: string | { name?: string; sourceRoots?: string[] } = "未命名项目"): Project {
    const name = typeof input === "string" ? input : input.name?.trim() || "未命名项目";
    const sourceRoots = typeof input === "string"
      ? []
      : [...new Set((input.sourceRoots ?? []).map((item) => item.trim()).filter(Boolean))];
    const now = Date.now();
    const project: Project = {
      id: id("proj"),
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: Number(
        (this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number } | undefined)
          ?.count ?? 0,
      ),
      sourceRoots,
    };
    this.db
      .prepare(
        'INSERT INTO projects(id, name, created_at, updated_at, pinned, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(project.id, project.name, project.createdAt, project.updatedAt, 0, project.order, encode({ sourceRoots }));
    return project;
  }

  renameProject(id: string, name: string): void {
    this.db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  setPinned(id: string, pinned: boolean): void {
    this.db
      .prepare("UPDATE projects SET pinned = ?, updated_at = ? WHERE id = ?")
      .run(pinned ? 1 : 0, Date.now(), id);
  }

  listSessions(projectId: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, title, created_at, updated_at, "order" FROM sessions WHERE project_id = ? ORDER BY "order", created_at, id',
      )
      .all(projectId) as SessionRow[];
    return rows.map(toSession);
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare('SELECT id, project_id, title, created_at, updated_at, "order" FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  ensureDefaultSession(projectId: string): SessionRecord {
    const existing = this.listSessions(projectId)[0];
    if (existing) return existing;
    return this.createSession(projectId, "默认会话");
  }

  createSession(projectId: string, title = "新会话"): SessionRecord {
    const project = this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
    if (!project) throw new Error("Project not found.");
    const now = Date.now();
    const order = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE project_id = ?").get(projectId) as { count: number } | undefined)
        ?.count ?? 0,
    );
    const session: SessionRecord = {
      id: id("sess"),
      projectId,
      title,
      createdAt: now,
      updatedAt: now,
      order,
    };
    this.db
      .prepare(
        'INSERT INTO sessions(id, project_id, title, created_at, updated_at, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(session.id, session.projectId, session.title, session.createdAt, session.updatedAt, session.order, encode({}));
    return session;
  }

  renameSession(id: string, title: string): void {
    this.db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  listNodes(sessionId: string): NodeRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, session_id, project_id, parent_id, title, seed, mount_ancestors, meta, layout_x, layout_y, layout_width, layout_height FROM nodes WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(sessionId) as NodeRow[];
    return rows.map((row) => this.toNode(row));
  }

  getNode(id: string): NodeRecord | undefined {
    const row = this.db
      .prepare("SELECT id, session_id, project_id, parent_id, title, seed, mount_ancestors, meta, layout_x, layout_y, layout_width, layout_height FROM nodes WHERE id = ?")
      .get(id) as NodeRow | undefined;
    return row ? this.toNode(row) : undefined;
  }

  createNode(input: {
    sessionId?: string;
    projectId?: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
  }): NodeRecord {
    const sessionId = input.sessionId ?? (input.projectId ? this.ensureDefaultSession(input.projectId).id : undefined);
    if (!sessionId) throw new Error("Session not found.");
    const session = this.getSession(sessionId);
    if (!session) throw new Error("Session not found.");
    if (input.parentId) {
      const parent = this.getNode(input.parentId);
      if (!parent || parent.sessionId !== sessionId) throw new Error("Parent node belongs to another Session.");
    }
    const now = Date.now();
    const node: NodeRecord = {
      id: id("n"),
      sessionId,
      projectId: session.projectId,
      parentId: input.parentId,
      title: input.title,
      seed: input.seed,
      mountAncestors: Boolean(input.mountAncestors),
      messages: [],
    };
    this.db
      .prepare(
        `INSERT INTO nodes(
          id, session_id, project_id, parent_id, title, seed, mount_ancestors, created_at, updated_at, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.sessionId,
        node.projectId,
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

  updateNodeLayout(id: string, layout: NodeLayout): boolean {
    const result = this.db
      .prepare(
        "UPDATE nodes SET layout_x = ?, layout_y = ?, layout_width = ?, layout_height = ?, updated_at = ? WHERE id = ?",
      )
      .run(layout.x, layout.y, layout.width, layout.height, Date.now(), id);
    return result.changes > 0;
  }

  updateNodeLayouts(items: Array<{ id: string; layout: NodeLayout }>): string[] {
    const update = this.db.prepare(
      "UPDATE nodes SET layout_x = ?, layout_y = ?, layout_width = ?, layout_height = ?, updated_at = ? WHERE id = ?",
    );
    const tx = this.db.transaction(() => {
      const updatedIds: string[] = [];
      const now = Date.now();
      for (const { id, layout } of items) {
        const result = update.run(layout.x, layout.y, layout.width, layout.height, now, id);
        if (result.changes > 0) updatedIds.push(id);
      }
      return updatedIds;
    });
    return tx();
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

  isApprovalPolicyAllowed(toolName: string, target: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM approval_policies WHERE tool_name = ? AND target = ?")
      .get(toolName, target);
    return Boolean(row);
  }

  grantApprovalPolicy(toolName: string, target: string): void {
    this.db
      .prepare(
        "INSERT INTO approval_policies(tool_name, target, created_at) VALUES (?, ?, ?) ON CONFLICT(tool_name, target) DO NOTHING",
      )
      .run(toolName, target, Date.now());
  }

  private toNode(row: NodeRow): NodeRecord {
    const meta = decode<Record<string, unknown>>(row.meta, {});
    const systemPrompt = typeof meta.systemPrompt === "string" ? meta.systemPrompt : undefined;
    const model = typeof meta.model === "string" ? meta.model : undefined;
    const color = typeof meta.color === "string" ? meta.color : undefined;
    return {
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      parentId: row.parent_id ?? undefined,
      title: row.title,
      seed: decode(row.seed, undefined),
      systemPrompt,
      model,
      color,
      layout: toLayout(row),
      mountAncestors: Boolean(row.mount_ancestors),
      messages: this.listMessages(row.id),
    };
  }
}

export function dbPath(userDataDir: string): string {
  return join(userDataDir, "loom.db");
}
