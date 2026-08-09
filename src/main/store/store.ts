import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FrozenNodeContext } from "../agent/core/context";
import type { DefaultTitleState } from "../../common/titleDefaults";
import type { StoredModelSelection } from "../modelConfig/modelRef";
import type { ThinkingLevel } from "../modelConfig/thinkingLevels";
import {
  isApprovalPolicy,
  isApprovalsReviewer,
  isSandboxMode,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type SandboxMode,
} from "../agent/core/permissions";

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

export interface PermissionSettings {
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: ApprovalsReviewer;
  networkAccess: boolean;
  writableRoots: string[];
  commandOutputLimit: number;
}

export function normalizePermissionSettings(value: unknown): PermissionSettings {
  const raw = value && typeof value === "object" ? value as Partial<PermissionSettings> : {};
  const commandOutputLimit = typeof raw.commandOutputLimit === "number" && Number.isFinite(raw.commandOutputLimit)
    ? Math.max(1_024, Math.min(1_000_000, Math.floor(raw.commandOutputLimit)))
    : DEFAULT_SETTINGS.permissions.commandOutputLimit;
  return {
    sandboxMode: isSandboxMode(raw.sandboxMode) ? raw.sandboxMode : DEFAULT_SETTINGS.permissions.sandboxMode,
    approvalPolicy: isApprovalPolicy(raw.approvalPolicy) ? raw.approvalPolicy : DEFAULT_SETTINGS.permissions.approvalPolicy,
    approvalsReviewer: isApprovalsReviewer(raw.approvalsReviewer) ? raw.approvalsReviewer : DEFAULT_SETTINGS.permissions.approvalsReviewer,
    networkAccess: raw.networkAccess === true,
    writableRoots: Array.isArray(raw.writableRoots)
      ? [...new Set(raw.writableRoots.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
      : [],
    commandOutputLimit,
  };
}

export interface Settings {
  access: AccessSettings;
  appearance: AppearanceSettings;
  monitor: MonitorSettings;
  activity: ActivitySettings;
  skills: SkillsSettings;
  permissions: PermissionSettings;
  apiKeyEnc?: string; // 本地保存的 API key 载荷；字段名沿用旧 schema，避免迁移。
}

export type SettingsPatch = Partial<Omit<Settings, "apiKeyEnc" | "access" | "appearance" | "monitor" | "activity" | "skills" | "permissions">> & {
  access?: Partial<AccessSettings>;
  appearance?: Partial<AppearanceSettings>;
  monitor?: Partial<MonitorSettings>;
  activity?: Partial<ActivitySettings>;
  skills?: Partial<SkillsSettings>;
  permissions?: Partial<PermissionSettings>;
};

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
  sourceRoots: string[];
  ui?: { activeSessionId?: string };
}

export interface SessionRecord {
  id: string;
  projectId: string;
  title: string;
  titleState?: DefaultTitleState;
  createdAt: number;
  updatedAt: number;
  order: number;
  ui?: SessionUiState;
}

/** Durable, renderer-owned resume state. Transcript and node layout stay in their own records. */
export interface SessionUiState {
  activeNodeId?: string;
  mode?: "chat" | "canvas";
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
  titleState?: DefaultTitleState;
  seed?: unknown;
  systemPrompt?: string;
  model?: StoredModelSelection;
  thinkingLevel?: ThinkingLevel;
  color?: string;
  layout?: NodeLayout;
  /** Versioned child-owned context captured at branch creation. */
  frozenContext?: FrozenNodeContext;
  messages: PersistedMessage[];
}

export interface Store {
  getSettings(): Settings;
  patchSettings(patch: SettingsPatch): Settings;
  getApiKeyEnc(): string | undefined;
  setApiKeyEnc(enc: string | undefined): void;

  listProjects(): Project[];
  createProject(input?: string | { name?: string; sourceRoots?: string[] }): Project;
  renameProject(id: string, name: string): void;
  deleteProject(id: string): void;
  setPinned(id: string, pinned: boolean): void;
  updateProjectUi?(id: string, patch: { activeSessionId?: string }): void;

  listSessions(projectId: string): SessionRecord[];
  getSession(id: string): SessionRecord | undefined;
  ensureDefaultSession(projectId: string): SessionRecord;
  createSession(projectId: string, title?: string, options?: { titleState?: DefaultTitleState }): SessionRecord;
  renameSession(id: string, title: string, options?: { titleState?: DefaultTitleState }): void;
  deleteSession(id: string): void;
  updateSessionUi?(id: string, patch: SessionUiState): void;

  listNodes(sessionId: string): NodeRecord[];
  getNode(id: string): NodeRecord | undefined;
  createNode(input: {
    sessionId?: string;
    projectId?: string;
    parentId?: string;
    title: string;
    titleState?: DefaultTitleState;
    seed?: unknown;
    frozenContext?: FrozenNodeContext;
  }): NodeRecord;
  updateNode(
    id: string,
    patch: Partial<{ title: string; titleState: DefaultTitleState; seed: unknown; frozenContext: FrozenNodeContext; systemPrompt: string; model: StoredModelSelection; thinkingLevel: ThinkingLevel; color: string }>,
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
  permissions: {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    networkAccess: false,
    writableRoots: [],
    commandOutputLimit: 64_000,
  },
};

export const SCHEMA_VERSION = 2;
