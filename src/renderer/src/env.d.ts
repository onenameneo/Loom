export {};

export interface ToolCallDto {
  id: string;
  name: string;
  state: "start" | "update" | "end";
  isError: boolean;
  summary?: string;
  args?: unknown;
  details?: unknown;
  startedAt: number;
  updatedAt: number;
}

export interface NodeMsg {
  role: "user" | "assistant" | "tool" | "skill" | "checkpoint";
  text: string;
  images?: { data: string; mimeType: string }[];
  seq: number;
  usage?: { totalTokens?: number };
  meta?: unknown;
  checkpoint?: {
    id: string;
    kind: "context" | "frozen-branch";
    reason?: "manual" | "threshold" | "overflow";
    createdAt: number;
    coverage: { fromSeq: number; toSeq: number };
    retainedTail?: { fromSeq: number; toSeq: number };
    diagnostics: {
      before: { tokens: number; exact: boolean };
      after: { tokens: number; exact: boolean };
    };
    summaryUsage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      exact: boolean;
    };
  };
  toolCall?: ToolCallDto;
  skillEvent?: {
    eventId: string;
    action: "skill-enabled" | "skill-disabled";
    skillId: string;
    name: string;
    sourcePath: string;
    hash: string;
  };
}
export interface NodeSeed {
  text: string;
  from: string;
  parent: string;
}
export type ModelSelection = string | { providerId: string; modelId: string };
export interface CanvasNodeDto {
  id: string;
  sessionId: string;
  projectId: string;
  parentId?: string;
  title: string;
  seed?: NodeSeed;
  mountAncestors: boolean;
  systemPrompt?: string;
  model?: ModelSelection;
  color?: string;
  layout?: { x: number; y: number; width: number; height: number };
  messages: NodeMsg[];
  skills?: SkillEffectiveDto[];
  skillContext?: {
    eventIds: string[];
    cacheKey: string;
    firstDivergence: "skill-context-tail" | "none";
    mode: "system" | "structured-user";
  };
}
export interface NodeBudget {
  withoutAncestors: number;
  withAncestors: number;
  estimated: boolean;
}
export interface CanvasEvent {
  nodeId: string;
  type: string;
  payload?: unknown;
}

export type TurnOperationKind = "send" | "regenerate" | "edit-resend";
export type TurnState = "running" | "awaiting_approval" | "completed" | "aborted" | "failed";
export type ApprovalScope = "once" | "node-session" | "persistent";

export interface TurnCanvasEventPayload {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: TurnState;
  error?: string;
  approval?: {
    requestId: string;
    toolName: string;
    toolCallId: string;
  };
}

export interface ApprovalRequestPayload {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  target: string;
  preview: {
    title: string;
    description?: string;
    args?: unknown;
  };
  defaultScope: ApprovalScope;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalDecisionPayload {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  action: "allow" | "deny";
  scope?: ApprovalScope;
}

export interface ToolCanvasEventPayload {
  state: "start" | "update" | "end";
  toolCallId: string;
  toolName: string;
  isError?: boolean;
  summary?: string;
  args?: unknown;
  details?: unknown;
}

export interface CompactionCanvasEventPayload {
  state: "planned" | "succeeded" | "failed" | "aborted";
  trigger: "manual" | "threshold" | "overflow";
  at: number;
  kind?: "none" | "retain-tail" | "split-turn";
  compactThroughSeq?: number;
  retainedFromSeq?: number;
  retainedTokenCount?: number;
  checkpointId?: string;
  coverage?: { fromSeq: number; toSeq: number };
  retainedTail?: { fromSeq: number; toSeq: number };
  diagnostics?: {
    before: { tokens: number; exact: boolean };
    after: { tokens: number; exact: boolean };
  };
  summaryUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    exact: boolean;
  };
  reason?: string;
  error?: string;
}

export type TypedCanvasEvent =
  | { nodeId: string; type: "tool"; payload: ToolCanvasEventPayload }
  | { nodeId: string; type: "turn"; payload: TurnCanvasEventPayload }
  | { nodeId: string; type: "approval"; payload: ApprovalRequestPayload }
  | { nodeId: string; type: "compaction"; payload: CompactionCanvasEventPayload }
  | CanvasEvent;

export interface AgentProc {
  pid: number;
  tool: "codex" | "claude";
  cwd?: string;
  project?: string;
  startedAt: number;
  cpu: number;
  status: "running" | "idle";
}

export interface MonitorEvent {
  type: "snapshot" | "started" | "stopped";
  agents: AgentProc[];
  agent?: AgentProc;
}

export type ActivityTool = "claude" | "codex";
export type ActivityKind =
  | "tool"
  | "permission"
  | "turn_end"
  | "session_start"
  | "stop"
  | "notification";

export interface ActivityEvent {
  id: string;
  tool: ActivityTool;
  sessionId: string;
  cwd?: string;
  project?: string;
  kind: ActivityKind;
  title: string;
  toolName?: string;
  detail?: string;
  ts: number;
}

export interface ActivitySession {
  key: string;
  tool: ActivityTool;
  sessionId: string;
  cwd?: string;
  project?: string;
  lastActiveAt: number;
  eventCount: number;
  events: ActivityEvent[];
}

export interface ActivityToolStatus {
  configured: boolean;
  verifiedAt?: number;
  lastEventAt?: number;
  path: string;
  actionRequired?: string;
}

export interface ActivityStatus {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  tools: Record<ActivityTool, ActivityToolStatus>;
}

export interface ActivityConfigArg {
  tools?: ActivityTool[];
}

export interface ActivityConfigNote {
  tool: ActivityTool;
  path: string;
  message: string;
}

export interface ActivityConfigResult {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  changed: string[];
  conflicts: ActivityConfigNote[];
  notes: ActivityConfigNote[];
  status: ActivityStatus;
}

export interface AcpSessionDto {
  id: string;
  cwd: string;
  project: string;
  status: "starting" | "ready" | "thinking" | "error" | "stopped";
  error?: string;
}

export interface AcpToolCall {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "error";
  kind?: string;
}

export interface AcpPermissionReq {
  sessionId: string;
  requestId: string;
  title: string;
  options: { id: string; label: string; kind?: string }[];
}

export interface AcpEvent {
  type: "started" | "update" | "permission" | "error" | "stopped";
  sessionId?: string;
  session?: AcpSessionDto;
  update?: any;
  requestId?: string;
  title?: string;
  options?: { id: string; label: string; kind?: string }[];
  message?: string;
  hint?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
  sourceRoots?: string[];
}

export interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface SettingsPayload {
  access: { provider: string; baseUrl: string; model: string };
  appearance: { theme: "light" | "dark" | "system"; density: "comfortable" | "compact" };
  monitor: { notify: boolean };
  skills?: { globalSources: string[] };
  modelRegistry?: ModelRegistryPayload;
  globalDefaultModel?: { providerId: string; modelId: string };
  sources: { baseUrl: string; model: string; key: string };
  hasKey: boolean;
  legacyKeyPresent?: boolean;
  keyStorage: "local";
  resolvedModel: string;
  resolvedTheme: "light" | "dark";
}

export interface SkillDiagnosticDto {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  path?: string;
}

export interface SkillCatalogItemDto {
  id: string;
  name: string;
  description: string;
  disableModelInvocation: boolean;
  scope: "global" | "project";
  sourceId: string;
  rootPath: string;
  skillFilePath: string;
  hash: string;
  trusted: boolean;
  active: boolean;
  diagnostics: SkillDiagnosticDto[];
}

export interface SkillEffectiveDto {
  id: string;
  name: string;
  description: string;
  sourceScope: "global" | "project";
  sourcePath: string;
  hash: string;
  diagnostics: SkillDiagnosticDto[];
}

export interface SkillCatalogDto {
  sources: Array<{ id: string; scope: "global" | "project"; rootPath: string; trusted: boolean; registered: boolean; projectId?: string }>;
  skills: SkillCatalogItemDto[];
  activeSkills: SkillCatalogItemDto[];
  diagnostics: SkillDiagnosticDto[];
}

export interface ModelListItem {
  id: string;
  name: string;
  providerId?: string;
  modelId?: string;
  available?: boolean;
  availability?: string;
  capabilities?: unknown;
}

export interface ModelRegistryPayload {
  providers: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    source: string;
    availability: string;
    diagnostics: Array<{ code: string; message: string; field?: string }>;
    hasAuthentication: boolean;
    hasPlaintextSecret: boolean;
    models: Array<{
      id: string;
      providerId: string;
      name: string;
      api: string;
      source: string;
      availability: string;
      available: boolean;
      diagnostics: Array<{ code: string; message: string; field?: string }>;
      capabilities: {
        reasoning: boolean;
        images: boolean;
        contextWindow: number;
        maxOutputTokens: number;
        compatibility?: unknown;
      };
    }>;
  }>;
}

export interface AddProviderModelPayload {
  providerId: string;
  providerName?: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  modelName?: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
  modelFromProvider?: boolean;
}

declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform;
      lifecycle: {
        ready: () => void;
      };
      canvas: {
        list: (sessionId: string) => Promise<CanvasNodeDto[]>;
        open: (sessionId: string) => Promise<CanvasNodeDto[]>;
        create: (arg: { sessionId: string; parentId?: string; seed?: NodeSeed; title?: string; mountAncestors?: boolean }) => Promise<CanvasNodeDto>;
        send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[], skillIds?: string[]) => Promise<{ ok: boolean; recovered?: "overflow"; reason?: string }>;
        abort: (nodeId: string) => Promise<{ ok: boolean }>;
        compact: (nodeId: string) => Promise<{ ok: boolean; node?: CanvasNodeDto; reason?: string; error?: string }>;
        regenerate: (nodeId: string) => Promise<{ ok: boolean }>;
        editResend: (arg: { nodeId: string; seq: number; text: string }) => Promise<{ ok: boolean }>;
        delete: (nodeId: string) => Promise<{ ok: boolean; deletedIds: string[] }>;
        setSystemPrompt: (nodeId: string, text: string) => Promise<{ ok: boolean }>;
        update: (nodeId: string, patch: { title?: string; color?: string }) => Promise<{ ok: boolean; node?: CanvasNodeDto }>;
        updateLayout: (
          nodeId: string,
          layout: { x: number; y: number; width: number; height: number },
        ) => Promise<{ ok: boolean; reason?: "not-found" | "invalid" | "storage" }>;
        updateLayouts: (
          items: Array<{ id: string; layout: { x: number; y: number; width: number; height: number } }>,
        ) => Promise<{ ok: boolean; updatedIds: string[]; reason?: "invalid" | "storage" }>;
        setModel: (nodeId: string, model: string | { providerId: string; modelId: string }) => Promise<{ ok: boolean }>;
        models: () => Promise<ModelListItem[]>;
        budget: (nodeId: string) => Promise<NodeBudget>;
        trace: (nodeId: string) => Promise<any>;
        onTrace: (listener: (snapshot: any) => void) => () => void;
        reset: (nodeId: string) => Promise<{ ok: boolean }>;
        skills: (nodeId: string) => Promise<{
          catalog: SkillCatalogDto;
          effective: { skills: SkillEffectiveDto[]; eventIds: string[]; diagnostics: SkillDiagnosticDto[] };
          context: { eventIds: string[]; cacheKey: string; firstDivergence: "skill-context-tail" | "none"; mode: "system" | "structured-user" };
        }>;
        enableSkill: (nodeId: string, skillId: string) => Promise<{ ok: boolean; node?: CanvasNodeDto; reason?: string }>;
        disableSkill: (nodeId: string, skillId: string) => Promise<{ ok: boolean; node?: CanvasNodeDto; reason?: string }>;
        decideApproval: (decision: ApprovalDecisionPayload) => Promise<{ ok: boolean; reason?: string }>;
        onEvent: (cb: (e: CanvasEvent) => void) => () => void;
      };
      settings: {
        get: () => Promise<SettingsPayload>;
        set: (patch: any) => Promise<{ ok: boolean; appearance: any }>;
        setGlobalModel: (model: { providerId: string; modelId: string }) => Promise<{ ok: boolean }>;
        addProviderModel: (input: AddProviderModelPayload) => Promise<{ ok: boolean }>;
        deleteProviderModel: (model: { providerId: string; modelId: string }) => Promise<{ ok: boolean }>;
        openModelsJson: () => Promise<{ ok: boolean; path: string; error?: string }>;
        skills: (projectId?: string) => Promise<SkillCatalogDto>;
        addSkillSource: (path: string) => Promise<{ ok: boolean; path: string }>;
        removeSkillSource: (path: string) => Promise<{ ok: boolean; path: string }>;
        openSkillSource: (path: string) => Promise<{ ok: boolean; path: string; error?: string }>;
      };
      monitor: {
        list: () => Promise<AgentProc[]>;
        onEvent: (cb: (e: MonitorEvent) => void) => () => void;
        setNotify: (on: boolean) => Promise<{ ok: boolean }>;
      };
      activity: {
        list: () => Promise<ActivitySession[]>;
        status: () => Promise<ActivityStatus>;
        enable: (arg: ActivityConfigArg) => Promise<ActivityConfigResult>;
        disable: (arg: ActivityConfigArg) => Promise<ActivityConfigResult>;
        onEvent: (cb: (e: ActivityEvent) => void) => () => void;
      };
      acp: {
        start: (arg: { cwd: string }) => Promise<{ ok: boolean; sessionId?: string; message?: string; hint?: string }>;
        prompt: (arg: { sessionId: string; text: string }) => Promise<{ ok: boolean; message?: string }>;
        cancel: (sessionId: string) => Promise<{ ok: boolean; message?: string }>;
        stop: (sessionId: string) => Promise<{ ok: boolean }>;
        respondPermission: (arg: { sessionId: string; requestId: string; optionId?: string }) => Promise<{ ok: boolean }>;
        pickDir: () => Promise<{ canceled: boolean; path?: string }>;
        list: () => Promise<AcpSessionDto[]>;
        onEvent: (cb: (e: AcpEvent) => void) => () => void;
      };
      projects: {
        list: () => Promise<ProjectMeta[]>;
        create: (input?: string | { name?: string; sourceRoots?: string[] }) => Promise<ProjectMeta>;
        rename: (id: string, name: string) => Promise<{ ok: boolean }>;
        delete: (id: string) => Promise<{ ok: boolean }>;
        pin: (id: string, pinned: boolean) => Promise<{ ok: boolean }>;
        pickSourceRoot: () => Promise<{ canceled: boolean; path?: string }>;
      };
      sessions: {
        list: (projectId: string) => Promise<SessionMeta[]>;
        create: (projectId: string, title?: string) => Promise<SessionMeta>;
        rename: (id: string, title: string) => Promise<{ ok: boolean }>;
        delete: (id: string) => Promise<{ ok: boolean }>;
      };
      onMenu: (cb: (action: string) => void) => () => void;
      onFullScreen: (cb: (fullscreen: boolean) => void) => () => void;
    };
  }
}
