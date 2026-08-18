import type { AgentMetricTotals, LlmUsage } from "../../../common/telemetry";

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
  thinking?: string;
  images?: { data: string; mimeType: string }[];
  fileMentions?: FileMentionRef[];
  seq: number;
  usage?: Partial<LlmUsage>;
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
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface CanvasNodeDto {
  id: string;
  sessionId: string;
  projectId: string;
  parentId?: string;
  title: string;
  seed?: NodeSeed;
  hasFrozenContext?: boolean;
  frozenContextMessageCount?: number;
  frozenContextTokenEstimate?: number;
  systemPrompt?: string;
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  color?: string;
  layout?: { x: number; y: number; width: number; height: number };
  branchPoint?: NodeBranchPoint;
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
  model?: { providerId: string; modelId: string };
  contextWindowTokens?: number;
  reserveOutputTokens?: number;
  safeInputBudget?: number;
  projectedInputTokens?: number;
  fixedContextTokens?: number;
  nodeLocalTailBudgetTokens?: number;
  overflowTokens?: number;
  status?: "ok" | "needs-compaction" | "fixed-context-overflow" | "model-unavailable";
  source?: "exact" | "mixed" | "estimated";
}
export interface CanvasEvent {
  nodeId: string;
  type: string;
  payload?: unknown;
}

export type TodoItemStatus = "pending" | "in_progress" | "completed" | "blocked";
export interface TodoItem {
  id: string;
  content: string;
  status: TodoItemStatus;
  dependsOn?: string[];
  result?: string;
}
export interface TodoPlanSnapshot {
  planId: string;
  nodeId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  status: "active" | "completed" | "blocked" | "cleared";
  todos: TodoItem[];
  updatedAt: number;
}
export interface TodoPlanEventPayload {
  nodeId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  snapshot: TodoPlanSnapshot;
}

export type TurnOperationKind = "send" | "regenerate" | "edit-resend";
export type TurnState = "running" | "awaiting_approval" | "completed" | "aborted" | "failed";
export interface LiveTurnSnapshot {
  nodeId: string;
  sessionId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: Extract<TurnState, "running" | "awaiting_approval">;
  revision: number;
  assistantText: string;
  assistantThinking?: string;
  approval?: {
    requestId: string;
    toolName: string;
    toolCallId: string;
    reason?: string;
    sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy?: "untrusted" | "on-request" | "never";
  };
}
export type LiveTurnEvent = { type: "upsert"; snapshot: LiveTurnSnapshot } | { type: "remove"; nodeId: string; revision: number };
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
    reason?: string;
    sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy?: "untrusted" | "on-request" | "never";
  };
}

export interface ApprovalRequestPayload {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  target: string;
  normalizedTarget?: string;
  reason?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "never";
  reviewer?: "user" | "auto-review";
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
  | { nodeId: string; type: "todo"; payload: TodoPlanEventPayload }
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
  ui?: { activeSessionId?: string };
}

export interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  order: number;
  ui?: { activeNodeId?: string; mode?: "chat" | "canvas" };
  branchSource?: BranchSource;
}

export interface BranchSource {
  projectId: string;
  sessionId: string;
  nodeId: string;
  messageSeq: number;
}

export interface NodeBranchPoint {
  sourceNodeId: string;
  sourceMessageSeq: number;
}

export interface SettingsPayload {
  access: { provider: string; baseUrl: string; model: string };
  appearance: { theme: "light" | "dark" | "system"; density: "comfortable" | "compact" };
  monitor: { notify: boolean };
  skills?: { globalSources: string[] };
  permissions?: {
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy: "untrusted" | "on-request" | "never";
    approvalsReviewer: "user" | "auto-review";
    networkAccess: boolean;
    writableRoots: string[];
    commandOutputLimit: number;
  };
  memory?: {
    enabled: boolean;
    backgroundExtraction: boolean;
    autoDream: boolean;
    rootDir?: string;
  };
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
  sources: Array<{ id: string; scope: "global" | "project"; rootPath: string; projectName?: string; trusted: boolean; registered: boolean; projectId?: string }>;
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
  capabilities?: {
    reasoning?: boolean;
    thinkingLevels?: ThinkingLevel[];
    images?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
    compatibility?: unknown;
  };
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
        thinkingLevels?: ThinkingLevel[];
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
        plan: (nodeId: string) => Promise<TodoPlanSnapshot | undefined>;
        open: (sessionId: string) => Promise<CanvasNodeDto[]>;
        create: (arg: { sessionId: string; parentId?: string; seed?: NodeSeed; title?: string; includeParentContext?: boolean }) => Promise<CanvasNodeDto>;
        branchFromMessage: (arg: { nodeId: string; sourceSeq: number; mode: "new-session" | "canvas-node" }) => Promise<{
          ok: boolean;
          reason?: string;
          mode?: "new-session" | "canvas-node";
          sessionId?: string;
          nodeId?: string;
          source?: BranchSource;
          node?: CanvasNodeDto;
        }>;
        send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[], skillIds?: string[], mentions?: FileMentionRef[]) => Promise<{ ok: boolean; recovered?: "overflow"; reason?: string; errors?: Array<{ root: string; path: string; code: string; message: string }> }>;
        fileCandidates: (nodeId: string, query?: string) => Promise<{ ok: boolean; candidates?: FileCandidate[]; reason?: string }>;
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
        setThinkingLevel: (nodeId: string, thinkingLevel: ThinkingLevel) => Promise<{ ok: boolean }>;
        models: () => Promise<ModelListItem[]>;
        budget: (nodeId: string) => Promise<NodeBudget>;
        trace: (nodeId: string) => Promise<import("./workbench/traceState").TraceSnapshotDto>;
        metrics: (nodeId: string) => Promise<AgentMetricTotals | undefined>;
        onTrace: (listener: (event: import("./workbench/traceState").TraceEventDto) => void) => () => void;
        liveTurns: () => Promise<LiveTurnSnapshot[]>;
        onLiveTurn: (listener: (event: LiveTurnEvent) => void) => () => void;
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
        set: (patch: any) => Promise<{ ok: boolean; appearance: any; permissions: SettingsPayload["permissions"] }>;
        getPermissions: () => Promise<NonNullable<SettingsPayload["permissions"]>>;
        setPermissions: (patch: Partial<NonNullable<SettingsPayload["permissions"]>>) => Promise<{ ok: boolean; permissions: NonNullable<SettingsPayload["permissions"]> }>;
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
      memory: {
        list: (arg?: { projectId?: string; includeArchived?: boolean }) => Promise<{
          records: Array<{
            id: string;
            type: "user" | "feedback" | "project" | "reference";
            scope: { kind: "user" } | { kind: "project"; projectId: string };
            status: "active" | "candidate" | "rejected" | "archived" | "stale" | "conflicted";
            confidence: number;
            description: string;
            content: string;
            source: { trigger: string; sessionId?: string; nodeId?: string; excerpt?: string };
            createdAt: number;
            updatedAt: number;
            supersedes?: string[];
            archivedReason?: string;
          }>;
          issues: Array<{ path: string; message: string }>;
          stats: { active: number; candidates: number; archived: number; stale: number; conflicted: number; issues: number };
        }>;
        stats: () => Promise<{ active: number; candidates: number; archived: number; stale: number; conflicted: number; issues: number }>;
        preview: (id: string) => Promise<{ record: unknown; markdown: string } | undefined>;
        remember: (input: any) => Promise<any>;
        edit: (arg: { id: string; patch: any }) => Promise<any>;
        archive: (id: string, reason?: string) => Promise<any>;
        forget: (id: string, reason?: string) => Promise<any>;
        approve: (id: string, overrides?: any) => Promise<any>;
        reject: (id: string, reason?: string) => Promise<any>;
        autodreamStatus: () => Promise<any>;
        autodreamRun: () => Promise<any>;
        autodreamCancel: () => Promise<{ ok: boolean }>;
        onEvent: (cb: (event: { type: string; [key: string]: unknown }) => void) => () => void;
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
        updateUi: (id: string, ui: { activeSessionId?: string }) => Promise<{ ok: boolean }>;
        pickSourceRoot: () => Promise<{ canceled: boolean; path?: string }>;
      };
      sessions: {
        list: (projectId: string) => Promise<SessionMeta[]>;
        create: (projectId: string, title?: string) => Promise<SessionMeta>;
        rename: (id: string, title: string) => Promise<{ ok: boolean }>;
        delete: (id: string) => Promise<{ ok: boolean }>;
        updateUi: (id: string, ui: { activeNodeId?: string; mode?: "chat" | "canvas" }) => Promise<{ ok: boolean }>;
      };
      onMenu: (cb: (action: string) => void) => () => void;
      onFullScreen: (cb: (fullscreen: boolean) => void) => () => void;
    };
  }
}
import type { FileCandidate, FileMentionRef } from "../../../common/fileMentions";
