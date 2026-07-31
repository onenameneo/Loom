import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { StoredModelSelection } from "../modelConfig/modelRef";

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

export interface MonitorSettings {
  notify: boolean;
}

export interface ActivitySettings {
  token?: string;
  port?: number;
  // 首次真实收到该工具事件的时刻。这是「已接入」的唯一凭据 —— 配置写没写
  // 只说明 Loom 的意图，收到过事件才说明它真的在工作。
  // （Codex 的 hook 信任哈希是其内部算法，无法从配置反推是否已生效。）
  verified?: { claude?: number; codex?: number };
}

export interface SkillsSettings {
  globalSources: string[];
}

export interface Settings {
  access: AccessSettings;
  appearance: AppearanceSettings;
  monitor: MonitorSettings;
  activity: ActivitySettings;
  skills: SkillsSettings;
  apiKeyEnc?: string; // 本地保存的 API key 载荷；字段名沿用旧 schema，避免迁移。
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
  sourceRoots: string[];
}

export interface SessionRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface StoreData {
  version: number;
  settings: Settings;
  projects: Project[];
  sessions?: SessionRecord[];
}

export interface PersistedMessage {
  id: string;
  seq: number;
  role: string;
  content: AgentMessage;
  meta?: unknown;
}

export const MIN_NODE_WIDTH = 288;
export const MIN_NODE_HEIGHT = 220;

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isValidNodeLayout(value: unknown): value is NodeLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Record<string, unknown>;
  return (
    typeof layout.x === "number" &&
    Number.isFinite(layout.x) &&
    typeof layout.y === "number" &&
    Number.isFinite(layout.y) &&
    typeof layout.width === "number" &&
    Number.isFinite(layout.width) &&
    layout.width >= MIN_NODE_WIDTH &&
    typeof layout.height === "number" &&
    Number.isFinite(layout.height) &&
    layout.height >= MIN_NODE_HEIGHT
  );
}

export interface NodeRecord {
  id: string;
  sessionId: string;
  projectId: string;
  parentId?: string;
  title: string;
  seed?: unknown;
  systemPrompt?: string;
  model?: StoredModelSelection;
  color?: string;
  layout?: NodeLayout;
  mountAncestors: boolean;
  /** Hidden immutable LLM context captured when this branch mounts its ancestors. */
  forkContextSnapshot?: AgentMessage[];
  /** Hidden immutable summary projection captured when mounted ancestors exceed child budget. */
  frozenBranchSummary?: AgentMessage;
  messages: PersistedMessage[];
}

export interface Store {
  getSettings(): Settings;
  patchSettings(patch: Partial<Omit<Settings, "apiKeyEnc">>): Settings;
  getApiKeyEnc(): string | undefined;
  setApiKeyEnc(enc: string | undefined): void;

  listProjects(): Project[];
  createProject(input?: string | { name?: string; sourceRoots?: string[] }): Project;
  renameProject(id: string, name: string): void;
  deleteProject(id: string): void;
  setPinned(id: string, pinned: boolean): void;

  listSessions(projectId: string): SessionRecord[];
  getSession(id: string): SessionRecord | undefined;
  ensureDefaultSession(projectId: string): SessionRecord;
  createSession(projectId: string, title?: string): SessionRecord;
  renameSession(id: string, title: string): void;
  deleteSession(id: string): void;

  listNodes(sessionId: string): NodeRecord[];
  getNode(id: string): NodeRecord | undefined;
  createNode(input: {
    sessionId?: string;
    projectId?: string;
    parentId?: string;
    title: string;
    seed?: unknown;
    mountAncestors?: boolean;
    forkContextSnapshot?: AgentMessage[];
    frozenBranchSummary?: AgentMessage;
  }): NodeRecord;
  updateNode(
    id: string,
    patch: Partial<{ title: string; mountAncestors: boolean; seed: unknown; forkContextSnapshot: AgentMessage[]; frozenBranchSummary: AgentMessage; systemPrompt: string; model: StoredModelSelection; color: string }>,
  ): void;
  updateNodeLayout(id: string, layout: NodeLayout): boolean;
  updateNodeLayouts(items: Array<{ id: string; layout: NodeLayout }>): string[];
  deleteNode(id: string): void;
  appendMessages(nodeId: string, msgs: PersistedMessage[]): void;
  replaceMessageContent?(nodeId: string, seq: number, content: AgentMessage): void;
  deleteMessagesFrom(nodeId: string, seq: number): void;
  listMessages(nodeId: string): PersistedMessage[];

  isApprovalPolicyAllowed?(toolName: string, target: string): boolean;
  grantApprovalPolicy?(toolName: string, target: string): void;
}

export const DEFAULT_SETTINGS: Settings = {
  access: { provider: "anthropic", baseUrl: "", model: "" },
  appearance: { theme: "system", density: "comfortable" },
  monitor: { notify: true },
  activity: {},
  skills: { globalSources: [] },
};

export const SCHEMA_VERSION = 2;
