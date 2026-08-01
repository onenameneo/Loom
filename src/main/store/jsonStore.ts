import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_SETTINGS,
  normalizePermissionSettings,
  SCHEMA_VERSION,
  type NodeLayout,
  type NodeRecord,
  type PersistedMessage,
  type SessionRecord,
  type Settings,
  type SettingsPatch,
  type Store,
  type StoreData,
  type Project,
} from "./store";
import { DEFAULT_SESSION_TITLE, type DefaultTitleState } from "../../common/titleDefaults";
import type { StoredModelSelection } from "../modelConfig/modelRef";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

// JSON-file 实现（原子写）。仓储接口的一个后端；之后可换 better-sqlite3，
// 上层不变。数据落在 app.getPath('userData')/canvas-data.json。
export class JsonStore implements Store {
  private data: StoreData;
  private idSeq = 0;
  constructor(private file: string) {
    this.data = this.load();
  }

  private normalizeProject(raw: any): Project | undefined {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return undefined;
    const sourceRoots: unknown[] = Array.isArray(raw.sourceRoots) ? raw.sourceRoots : [];
    return {
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : "未命名项目",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      pinned: Boolean(raw.pinned),
      order: typeof raw.order === "number" ? raw.order : 0,
      sourceRoots: [...new Set(sourceRoots.filter((item): item is string => typeof item === "string" && item.length > 0))],
    };
  }

  private load(): StoreData {
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf-8"));
        return {
          version: raw.version ?? SCHEMA_VERSION,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(raw.settings ?? {}),
            skills: { ...DEFAULT_SETTINGS.skills, ...(raw.settings?.skills ?? {}) },
            permissions: normalizePermissionSettings(raw.settings?.permissions),
          },
          projects: (Array.isArray(raw.projects) ? raw.projects : [])
            .map((project: any) => this.normalizeProject(project))
            .filter((project: Project | undefined): project is Project => Boolean(project)),
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

  private id(prefix: string): string {
    this.idSeq += 1;
    const now = Date.now();
    return `${prefix}_${now.toString(36)}_${this.idSeq.toString(36)}`;
  }

  getSettings(): Settings {
    return this.data.settings;
  }
  patchSettings(patch: SettingsPatch): Settings {
    this.data.settings = {
      ...this.data.settings,
      access: { ...this.data.settings.access, ...(patch.access ?? {}) },
      appearance: { ...this.data.settings.appearance, ...(patch.appearance ?? {}) },
      monitor: { ...this.data.settings.monitor, ...(patch.monitor ?? {}) },
      activity: { ...this.data.settings.activity, ...(patch.activity ?? {}) },
      skills: { ...this.data.settings.skills, ...(patch.skills ?? {}) },
      permissions: normalizePermissionSettings({ ...this.data.settings.permissions, ...(patch.permissions ?? {}) }),
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
  createProject(input: string | { name?: string; sourceRoots?: string[] } = "未命名项目"): Project {
    const name = typeof input === "string" ? input : input.name?.trim() || "未命名项目";
    const sourceRoots = typeof input === "string"
      ? []
      : [...new Set((input.sourceRoots ?? []).map((item) => item.trim()).filter(Boolean))];
    const now = Date.now();
    const project: Project = {
      id: this.id("project"),
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: this.data.projects.length,
      sourceRoots,
    };
    this.data.projects.push(project);
    this.flush();
    return project;
  }
  renameProject(id: string, name: string): void {
    const project = this.data.projects.find((w) => w.id === id);
    if (project) {
      project.name = name;
      project.updatedAt = Date.now();
      this.flush();
    }
  }
  deleteProject(id: string): void {
    this.data.projects = this.data.projects.filter((w) => w.id !== id);
    this.data.sessions = (this.data.sessions ?? []).filter((session) => session.projectId !== id);
    this.flush();
  }
  setPinned(id: string, pinned: boolean): void {
    const project = this.data.projects.find((w) => w.id === id);
    if (project) {
      project.pinned = pinned;
      project.updatedAt = Date.now();
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
    return this.listSessions(projectId)[0] ?? this.createSession(projectId, DEFAULT_SESSION_TITLE, { titleState: "default" });
  }
  createSession(projectId: string, title = "新会话", options: { titleState?: DefaultTitleState } = {}): SessionRecord {
    const now = Date.now();
    const session: SessionRecord = {
      id: this.id("session"),
      projectId,
      title,
      titleState: options.titleState,
      createdAt: now,
      updatedAt: now,
      order: this.listSessions(projectId).length,
    };
    this.data.sessions = [...(this.data.sessions ?? []), session];
    this.flush();
    return session;
  }
  renameSession(id: string, title: string, options: { titleState?: DefaultTitleState } = {}): void {
    const session = this.getSession(id);
    if (session) {
      session.title = title;
      if (options.titleState) session.titleState = options.titleState;
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
    parentId?: string;
    title: string;
    titleState?: DefaultTitleState;
    seed?: unknown;
    mountAncestors?: boolean;
    forkContextSnapshot?: AgentMessage[];
    frozenBranchSummary?: AgentMessage;
  }): NodeRecord {
    throw new Error("JsonStore does not implement canvas node persistence.");
  }
  updateNode(
    _id: string,
    _patch: Partial<{ title: string; titleState: DefaultTitleState; mountAncestors: boolean; seed: unknown; forkContextSnapshot: AgentMessage[]; frozenBranchSummary: AgentMessage; systemPrompt: string; model: StoredModelSelection; color: string }>,
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
