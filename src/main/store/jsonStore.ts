import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type NodeLayout,
  type NodeRecord,
  type PersistedMessage,
  type SessionRecord,
  type Settings,
  type Store,
  type StoreData,
  type Project,
} from "./store";

// JSON-file 实现（原子写）。仓储接口的一个后端；之后可换 better-sqlite3，
// 上层不变。数据落在 app.getPath('userData')/canvas-data.json。
export class JsonStore implements Store {
  private data: StoreData;
  constructor(private file: string) {
    this.data = this.load();
  }

  private load(): StoreData {
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf-8"));
        return {
          version: raw.version ?? SCHEMA_VERSION,
          settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
          projects: Array.isArray(raw.projects) ? raw.projects : [],
          sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        };
      } catch {
        // 损坏文件不阻塞启动；退回默认（旧文件保留在磁盘上）
      }
    }
    return { version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, projects: [], sessions: [] };
  }

  private flush() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    renameSync(tmp, this.file); // 原子替换
  }

  getSettings(): Settings {
    return this.data.settings;
  }
  patchSettings(patch: Partial<Omit<Settings, "apiKeyEnc">>): Settings {
    this.data.settings = {
      ...this.data.settings,
      access: { ...this.data.settings.access, ...(patch.access ?? {}) },
      appearance: { ...this.data.settings.appearance, ...(patch.appearance ?? {}) },
      monitor: { ...this.data.settings.monitor, ...(patch.monitor ?? {}) },
      activity: { ...this.data.settings.activity, ...(patch.activity ?? {}) },
    };
    this.flush();
    return this.data.settings;
  }
  getApiKeyEnc(): string | undefined {
    return this.data.settings.apiKeyEnc;
  }
  setApiKeyEnc(enc: string | undefined): void {
    this.data.settings.apiKeyEnc = enc;
    this.flush();
  }

  listProjects(): Project[] {
    return [...this.data.projects].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.updatedAt - a.updatedAt,
    );
  }
  createProject(input: string | { name?: string; sourceRoots?: string[]; sourceFolders?: string[] } = "未命名项目"): Project {
    const name = typeof input === "string" ? input : input.name?.trim() || "未命名项目";
    const sourceRoots = typeof input === "string"
      ? []
      : [...new Set(((input.sourceRoots ?? input.sourceFolders) ?? []).map((item) => item.trim()).filter(Boolean))];
    const now = Date.now();
    const ws: Project = {
      id: `ws_${now.toString(36)}_${Math.floor(now % 100000).toString(36)}`,
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: this.data.projects.length,
      sourceRoots,
    };
    this.data.projects.push(ws);
    this.flush();
    return ws;
  }
  renameProject(id: string, name: string): void {
    const ws = this.data.projects.find((w) => w.id === id);
    if (ws) {
      ws.name = name;
      ws.updatedAt = Date.now();
      this.flush();
    }
  }
  deleteProject(id: string): void {
    this.data.projects = this.data.projects.filter((w) => w.id !== id);
    this.flush();
  }
  listWorkspaces(): Project[] {
    return this.listProjects();
  }
  createWorkspace(input: string | { name?: string; sourceFolders?: string[]; sourceRoots?: string[] } = "未命名项目"): Project {
    return this.createProject(input);
  }
  renameWorkspace(id: string, name: string): void {
    this.renameProject(id, name);
  }
  deleteWorkspace(id: string): void {
    this.deleteProject(id);
  }
  setPinned(id: string, pinned: boolean): void {
    const ws = this.data.projects.find((w) => w.id === id);
    if (ws) {
      ws.pinned = pinned;
      ws.updatedAt = Date.now();
      this.flush();
    }
  }

  listSessions(projectId: string): SessionRecord[] {
    return [...(this.data.sessions ?? [])]
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }
  getSession(id: string): SessionRecord | undefined {
    return (this.data.sessions ?? []).find((session) => session.id === id);
  }
  ensureDefaultSession(projectId: string): SessionRecord {
    return this.listSessions(projectId)[0] ?? this.createSession(projectId, "默认会话");
  }
  createSession(projectId: string, title = "新会话"): SessionRecord {
    const now = Date.now();
    const session: SessionRecord = {
      id: `sess_${now.toString(36)}_${Math.floor(now % 100000).toString(36)}`,
      projectId,
      title,
      createdAt: now,
      updatedAt: now,
      order: this.listSessions(projectId).length,
    };
    this.data.sessions = [...(this.data.sessions ?? []), session];
    this.flush();
    return session;
  }
  renameSession(id: string, title: string): void {
    const session = this.getSession(id);
    if (session) {
      session.title = title;
      session.updatedAt = Date.now();
      this.flush();
    }
  }
  deleteSession(id: string): void {
    this.data.sessions = (this.data.sessions ?? []).filter((session) => session.id !== id);
    this.flush();
  }

  listNodes(_sessionId: string): NodeRecord[] {
    return [];
  }
  getNode(_id: string): NodeRecord | undefined {
    return undefined;
  }
  createNode(_input: {
    sessionId?: string;
    projectId?: string;
    workspaceId?: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
  }): NodeRecord {
    throw new Error("JsonStore does not implement canvas node persistence.");
  }
  updateNode(
    _id: string,
    _patch: Partial<{ title: string; mountAncestors: boolean; seed: unknown; systemPrompt: string; model: string; color: string }>,
  ): void {}
  updateNodeLayout(_id: string, _layout: NodeLayout): boolean {
    return false;
  }
  updateNodeLayouts(_items: Array<{ id: string; layout: NodeLayout }>): string[] {
    return [];
  }
  deleteNode(_id: string): void {}
  appendMessages(_nodeId: string, _msgs: PersistedMessage[]): void {}
  deleteMessagesFrom(_nodeId: string, _seq: number): void {}
  listMessages(_nodeId: string): PersistedMessage[] {
    return [];
  }
}

export function storePath(userDataDir: string): string {
  return join(userDataDir, "canvas-data.json");
}
