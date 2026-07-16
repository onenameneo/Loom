import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type NodeRecord,
  type PersistedMessage,
  type Settings,
  type Store,
  type StoreData,
  type Workspace,
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
          workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
        };
      } catch {
        // 损坏文件不阻塞启动；退回默认（旧文件保留在磁盘上）
      }
    }
    return { version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, workspaces: [] };
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

  listWorkspaces(): Workspace[] {
    return [...this.data.workspaces].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.updatedAt - a.updatedAt,
    );
  }
  createWorkspace(name = "未命名会话"): Workspace {
    const now = Date.now();
    const ws: Workspace = {
      id: `ws_${now.toString(36)}_${Math.floor(now % 100000).toString(36)}`,
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: this.data.workspaces.length,
    };
    this.data.workspaces.push(ws);
    this.flush();
    return ws;
  }
  renameWorkspace(id: string, name: string): void {
    const ws = this.data.workspaces.find((w) => w.id === id);
    if (ws) {
      ws.name = name;
      ws.updatedAt = Date.now();
      this.flush();
    }
  }
  deleteWorkspace(id: string): void {
    this.data.workspaces = this.data.workspaces.filter((w) => w.id !== id);
    this.flush();
  }
  setPinned(id: string, pinned: boolean): void {
    const ws = this.data.workspaces.find((w) => w.id === id);
    if (ws) {
      ws.pinned = pinned;
      ws.updatedAt = Date.now();
      this.flush();
    }
  }

  listNodes(_workspaceId: string): NodeRecord[] {
    return [];
  }
  getNode(_id: string): NodeRecord | undefined {
    return undefined;
  }
  createNode(_input: {
    workspaceId: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
  }): NodeRecord {
    throw new Error("JsonStore does not implement canvas node persistence.");
  }
  updateNode(
    _id: string,
    _patch: Partial<{ title: string; mountAncestors: boolean; seed: unknown; systemPrompt: string; model: string }>,
  ): void {}
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
