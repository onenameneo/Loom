import { mkdirSync } from "fs";
import { dirname, join } from "path";
import Database from "better-sqlite3";
import { migrate } from "./migrations";
import {
  DEFAULT_SETTINGS,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  normalizePermissionSettings,
  isValidNodeLayout,
  type NodeLayout,
  type NodeRecord,
  type PersistedMessage,
  type SessionRecord,
  type SessionUiState,
  type Settings,
  type SettingsPatch,
  type Store,
  type Project,
  type AgentMetricRecord,
  type AgentMetricTotals,
} from "./store";
import { mergeLlmUsage } from "../agent/core/usage";
import { DEFAULT_SESSION_TITLE, type DefaultTitleState } from "../../common/titleDefaults";
import { parseStoredModelRef, type StoredModelSelection } from "../modelConfig/modelRef";
import { isThinkingLevel, type ThinkingLevel } from "../modelConfig/thinkingLevels";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FrozenNodeContext } from "../agent/core/context";

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
  meta: string | null;
};

type NodeRow = {
  id: string;
  session_id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  seed: string | null;
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

type AgentMetricRow = {
  id: string;
  node_id: string;
  session_id: string;
  turn_id: string | null;
  request_id: string | null;
  tool_call_id: string | null;
  kind: AgentMetricRecord["kind"];
  provider_id: string | null;
  model_id: string | null;
  name: string | null;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
  ttft_ms: number | null;
  status: AgentMetricRecord["status"];
  usage: string | null;
  created_at: number;
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
    ui: meta.ui && typeof meta.ui === "object" && typeof (meta.ui as Record<string, unknown>).activeSessionId === "string"
      ? { activeSessionId: (meta.ui as Record<string, string>).activeSessionId }
      : undefined,
  };
}

function toSession(row: SessionRow): SessionRecord {
  const meta = decode<Record<string, unknown>>(row.meta, {});
  const titleState = meta.titleState === "default" || meta.titleState === "manual" ? meta.titleState : undefined;
  const ui = meta.ui && typeof meta.ui === "object" ? meta.ui as Record<string, unknown> : undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    titleState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    order: row.order,
    ui: ui && (typeof ui.activeNodeId === "string" || ui.mode === "chat" || ui.mode === "canvas")
      ? {
          ...(typeof ui.activeNodeId === "string" ? { activeNodeId: ui.activeNodeId } : {}),
          ...(ui.mode === "chat" || ui.mode === "canvas" ? { mode: ui.mode } : {}),
        }
      : undefined,
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
      skills: decode(values.get("skills"), DEFAULT_SETTINGS.skills),
      permissions: normalizePermissionSettings(decode(values.get("permissions"), DEFAULT_SETTINGS.permissions)),
      apiKeyEnc: decode<string | undefined>(values.get("apiKeyEnc"), undefined),
    };
  }

  patchSettings(patch: SettingsPatch): Settings {
    const current = this.getSettings();
    const next: Settings = {
      ...current,
      access: { ...current.access, ...(patch.access ?? {}) },
      appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
      monitor: { ...current.monitor, ...(patch.monitor ?? {}) },
      activity: { ...current.activity, ...(patch.activity ?? {}) },
      skills: { ...current.skills, ...(patch.skills ?? {}) },
      permissions: normalizePermissionSettings({ ...current.permissions, ...(patch.permissions ?? {}) }),
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
      stmt.run("skills", encode(next.skills));
      stmt.run("permissions", encode(next.permissions));
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

  updateProjectUi(id: string, patch: { activeSessionId?: string }): void {
    const row = this.db.prepare("SELECT meta FROM projects WHERE id = ?").get(id) as { meta: string | null } | undefined;
    if (!row) return;
    const meta = decode<Record<string, unknown>>(row.meta, {});
    meta.ui = { ...(meta.ui && typeof meta.ui === "object" ? meta.ui as Record<string, unknown> : {}), ...(typeof patch.activeSessionId === "string" ? { activeSessionId: patch.activeSessionId } : {}) };
    this.db.prepare("UPDATE projects SET meta = ? WHERE id = ?").run(encode(meta), id);
  }

  listSessions(projectId: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, title, created_at, updated_at, "order", meta FROM sessions WHERE project_id = ? ORDER BY "order", created_at, id',
      )
      .all(projectId) as SessionRow[];
    return rows.map(toSession);
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare('SELECT id, project_id, title, created_at, updated_at, "order", meta FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  ensureDefaultSession(projectId: string): SessionRecord {
    const existing = this.listSessions(projectId)[0];
    if (existing) return existing;
    return this.createSession(projectId, DEFAULT_SESSION_TITLE, { titleState: "default" });
  }

  createSession(projectId: string, title = "新会话", options: { titleState?: DefaultTitleState } = {}): SessionRecord {
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
      titleState: options.titleState,
      createdAt: now,
      updatedAt: now,
      order,
    };
    this.db
      .prepare(
        'INSERT INTO sessions(id, project_id, title, created_at, updated_at, "order", meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(session.id, session.projectId, session.title, session.createdAt, session.updatedAt, session.order, encode({
        ...(session.titleState ? { titleState: session.titleState } : {}),
      }));
    return session;
  }

  renameSession(id: string, title: string, options: { titleState?: DefaultTitleState } = {}): void {
    const row = this.db.prepare("SELECT meta FROM sessions WHERE id = ?").get(id) as
      | { meta: string | null }
      | undefined;
    const meta = decode<Record<string, unknown>>(row?.meta, {});
    if (options.titleState) meta.titleState = options.titleState;
    this.db.prepare("UPDATE sessions SET title = ?, meta = ?, updated_at = ? WHERE id = ?").run(title, encode(meta), Date.now(), id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  updateSessionUi(id: string, patch: SessionUiState): void {
    const row = this.db.prepare("SELECT meta FROM sessions WHERE id = ?").get(id) as { meta: string | null } | undefined;
    if (!row) return;
    const meta = decode<Record<string, unknown>>(row.meta, {});
    const current = meta.ui && typeof meta.ui === "object" ? meta.ui as Record<string, unknown> : {};
    meta.ui = {
      ...current,
      ...(typeof patch.activeNodeId === "string" ? { activeNodeId: patch.activeNodeId } : {}),
      ...(patch.mode === "chat" || patch.mode === "canvas" ? { mode: patch.mode } : {}),
    };
    this.db.prepare("UPDATE sessions SET meta = ? WHERE id = ?").run(encode(meta), id);
  }

  listNodes(sessionId: string): NodeRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, session_id, project_id, parent_id, title, seed, meta, layout_x, layout_y, layout_width, layout_height FROM nodes WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(sessionId) as NodeRow[];
    return rows.map((row) => this.toNode(row));
  }

  getNode(id: string): NodeRecord | undefined {
    const row = this.db
      .prepare("SELECT id, session_id, project_id, parent_id, title, seed, meta, layout_x, layout_y, layout_width, layout_height FROM nodes WHERE id = ?")
      .get(id) as NodeRow | undefined;
    return row ? this.toNode(row) : undefined;
  }

  createNode(input: {
    sessionId?: string;
    projectId?: string;
    parentId?: string;
    title: string;
    titleState?: DefaultTitleState;
    seed?: unknown;
    frozenContext?: FrozenNodeContext;
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
      titleState: input.titleState,
      seed: input.seed,
      frozenContext: input.frozenContext,
      messages: [],
    };
    this.db
      .prepare(
        `INSERT INTO nodes(
          id, session_id, project_id, parent_id, title, seed, created_at, updated_at, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.sessionId,
        node.projectId,
        node.parentId ?? null,
        node.title,
        node.seed === undefined ? null : encode(node.seed),
        now,
        now,
        encode({
          ...(node.titleState ? { titleState: node.titleState } : {}),
          ...(node.frozenContext ? { frozenContext: node.frozenContext } : {}),
        }),
      );
    return node;
  }

  updateNode(
    id: string,
    patch: Partial<{ title: string; titleState: DefaultTitleState; seed: unknown; frozenContext: FrozenNodeContext; systemPrompt: string; model: StoredModelSelection; thinkingLevel: ThinkingLevel; color: string }>,
  ): void {
    const current = this.getNode(id);
    if (!current) return;
    const row = this.db.prepare("SELECT meta FROM nodes WHERE id = ?").get(id) as
      | { meta: string | null }
      | undefined;
    const meta = decode<Record<string, unknown>>(row?.meta, {});
    if (Object.prototype.hasOwnProperty.call(patch, "frozenContext")) {
      meta.frozenContext = patch.frozenContext;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "systemPrompt")) {
      const text = patch.systemPrompt?.trim() ?? "";
      if (text) meta.systemPrompt = text;
      else delete meta.systemPrompt;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "model")) {
      const parsed = parseStoredModelRef(patch.model);
      if (parsed.kind === "ref") meta.model = parsed.ref;
      else if (parsed.kind === "legacy") meta.model = parsed.legacyModel;
      else delete meta.model;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "thinkingLevel")) {
      if (isThinkingLevel(patch.thinkingLevel)) meta.thinkingLevel = patch.thinkingLevel;
      else delete meta.thinkingLevel;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "color")) {
      const color = patch.color?.trim() ?? "";
      if (color) meta.color = color;
      else delete meta.color;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "titleState")) {
      if (patch.titleState) meta.titleState = patch.titleState;
      else delete meta.titleState;
    }
    this.db
      .prepare("UPDATE nodes SET title = ?, seed = ?, meta = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.title ?? current.title,
        Object.prototype.hasOwnProperty.call(patch, "seed") ? encode(patch.seed) : encode(current.seed),
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

  replaceMessageContent(nodeId: string, seq: number, content: AgentMessage): void {
    this.db
      .prepare("UPDATE messages SET role = ?, content = ?, meta = meta WHERE node_id = ? AND seq = ?")
      .run(String((content as any)?.role ?? "custom"), encode(content), nodeId, seq);
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

  appendMetric(metric: AgentMetricRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_metrics(
        id, node_id, session_id, turn_id, request_id, tool_call_id, kind,
        provider_id, model_id, name, started_at, ended_at, duration_ms, ttft_ms,
        status, usage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metric.id,
      metric.nodeId,
      metric.sessionId,
      metric.turnId ?? null,
      metric.requestId ?? null,
      metric.toolCallId ?? null,
      metric.kind,
      metric.providerId ?? null,
      metric.modelId ?? null,
      metric.name ?? null,
      metric.startedAt ?? null,
      metric.endedAt ?? null,
      metric.durationMs ?? null,
      metric.ttftMs ?? null,
      metric.status,
      metric.usage === undefined ? null : encode(metric.usage),
      metric.createdAt,
    );
  }

  listMetrics(scope: { nodeId?: string; sessionId?: string }): AgentMetricRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (scope.nodeId) { clauses.push("node_id = ?"); params.push(scope.nodeId); }
    if (scope.sessionId) { clauses.push("session_id = ?"); params.push(scope.sessionId); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM agent_metrics${where} ORDER BY created_at, id`).all(...params) as AgentMetricRow[];
    return rows.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      sessionId: row.session_id,
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      ...(row.request_id ? { requestId: row.request_id } : {}),
      ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
      kind: row.kind,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      ...(row.model_id ? { modelId: row.model_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      ...(row.ttft_ms !== null ? { ttftMs: row.ttft_ms } : {}),
      status: row.status,
      ...(row.usage ? { usage: decode<AgentMetricRecord["usage"]>(row.usage, undefined) } : {}),
      createdAt: row.created_at,
    }));
  }

  getMetricTotals(scope: { nodeId?: string; sessionId?: string }): AgentMetricTotals {
    const metrics = this.listMetrics(scope);
    const llmDurationMs = metrics.filter((metric) => metric.kind === "llm").reduce((sum, metric) => sum + (metric.durationMs ?? 0), 0);
    const outputTokens = metrics.filter((metric) => metric.kind === "llm").reduce((sum, metric) => sum + (metric.usage?.output ?? 0), 0);
    return {
      turns: metrics.filter((metric) => metric.kind === "turn").length,
      llmRequests: metrics.filter((metric) => metric.kind === "llm").length,
      toolCalls: metrics.filter((metric) => metric.kind === "tool").length,
      compactions: metrics.filter((metric) => metric.kind === "compaction").length,
      durationMs: metrics.reduce((sum, metric) => sum + (metric.durationMs ?? 0), 0),
      ttftMs: metrics.reduce((sum, metric) => sum + (metric.ttftMs ?? 0), 0),
      outputTokensPerSecond: llmDurationMs > 0 ? outputTokens / (llmDurationMs / 1000) : 0,
      usage: mergeLlmUsage(metrics.map((metric) => metric.usage)),
    };
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
    const parsedModel = parseStoredModelRef(meta.model);
    const model = parsedModel.kind === "ref" ? parsedModel.ref : parsedModel.kind === "legacy" ? parsedModel.legacyModel : undefined;
    const thinkingLevel = isThinkingLevel(meta.thinkingLevel) ? meta.thinkingLevel : undefined;
    const color = typeof meta.color === "string" ? meta.color : undefined;
    const titleState = meta.titleState === "default" || meta.titleState === "manual" ? meta.titleState : undefined;
    const frozenContext = meta.frozenContext && typeof meta.frozenContext === "object" ? meta.frozenContext as FrozenNodeContext : undefined;
    return {
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      parentId: row.parent_id ?? undefined,
      title: row.title,
      titleState,
      seed: decode(row.seed, undefined),
      systemPrompt,
      model,
      thinkingLevel,
      color,
      layout: toLayout(row),
      frozenContext,
      messages: this.listMessages(row.id),
    };
  }
}

export function dbPath(userDataDir: string): string {
  return join(userDataDir, "loom.db");
}
