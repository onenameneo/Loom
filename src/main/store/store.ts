import type { AgentMessage } from "@mariozechner/pi-agent-core";

// 持久化仓储契约。组件/服务只依赖这个接口；实现可从 JSON-file 换到 SQLite，
// 无需改上层。见 openspec/changes/app-shell/design.md D2/D6。

export type ThemePref = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

export interface AccessSettings {
  provider: string; // 目前固定 "anthropic"（含 Anthropic 兼容代理）
  baseUrl: string; // 空 = 用官方 / env
  model: string; // 空 = 用 env / 默认
}

export interface AppearanceSettings {
  theme: ThemePref;
  density: Density;
}

export interface Settings {
  access: AccessSettings;
  appearance: AppearanceSettings;
  apiKeyEnc?: string; // safeStorage 加密后的 base64；明文永不落盘
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
}

export interface StoreData {
  version: number;
  settings: Settings;
  workspaces: Workspace[];
}

export interface PersistedMessage {
  id: string;
  seq: number;
  role: string;
  content: AgentMessage;
  meta?: unknown;
}

export interface NodeRecord {
  id: string;
  workspaceId: string;
  parentId?: string;
  title: string;
  seed?: unknown;
  systemPrompt?: string;
  model?: string;
  color?: string;
  mountAncestors: boolean;
  messages: PersistedMessage[];
}

export interface Store {
  getSettings(): Settings;
  patchSettings(patch: Partial<Omit<Settings, "apiKeyEnc">>): Settings;
  getApiKeyEnc(): string | undefined;
  setApiKeyEnc(enc: string | undefined): void;

  listWorkspaces(): Workspace[];
  createWorkspace(name?: string): Workspace;
  renameWorkspace(id: string, name: string): void;
  deleteWorkspace(id: string): void;
  setPinned(id: string, pinned: boolean): void;

  listNodes(workspaceId: string): NodeRecord[];
  getNode(id: string): NodeRecord | undefined;
  createNode(input: {
    workspaceId: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
  }): NodeRecord;
  updateNode(
    id: string,
    patch: Partial<{ title: string; mountAncestors: boolean; seed: unknown; systemPrompt: string; model: string; color: string }>,
  ): void;
  deleteNode(id: string): void;
  appendMessages(nodeId: string, msgs: PersistedMessage[]): void;
  deleteMessagesFrom(nodeId: string, seq: number): void;
  listMessages(nodeId: string): PersistedMessage[];
}

export const DEFAULT_SETTINGS: Settings = {
  access: { provider: "anthropic", baseUrl: "", model: "" },
  appearance: { theme: "system", density: "comfortable" },
};

export const SCHEMA_VERSION = 1;
