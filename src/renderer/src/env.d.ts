export {};

export interface NodeMsg {
  role: "user" | "assistant";
  text: string;
  images?: { data: string; mimeType: string }[];
  seq: number;
  usage?: { totalTokens?: number };
  meta?: unknown;
}
export interface NodeSeed {
  text: string;
  from: string;
  parent: string;
}
export interface CanvasNodeDto {
  id: string;
  workspaceId: string;
  parentId?: string;
  title: string;
  seed?: NodeSeed;
  mountAncestors: boolean;
  systemPrompt?: string;
  model?: string;
  color?: string;
  layout?: { x: number; y: number; width: number; height: number };
  messages: NodeMsg[];
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

export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  order: number;
}

export interface SettingsPayload {
  access: { provider: string; baseUrl: string; model: string };
  appearance: { theme: "light" | "dark" | "system"; density: "comfortable" | "compact" };
  monitor: { notify: boolean };
  sources: { baseUrl: string; model: string; key: string };
  hasKey: boolean;
  encryptionAvailable: boolean;
  resolvedModel: string;
  resolvedTheme: "light" | "dark";
}

declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform;
      canvas: {
        list: (workspaceId: string) => Promise<CanvasNodeDto[]>;
        open: (workspaceId: string) => Promise<CanvasNodeDto[]>;
        create: (arg: { workspaceId: string; parentId?: string; seed?: NodeSeed; title?: string }) => Promise<CanvasNodeDto>;
        send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[]) => Promise<{ ok: boolean }>;
        abort: (nodeId: string) => Promise<{ ok: boolean }>;
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
        setMount: (nodeId: string, on: boolean) => Promise<{ ok: boolean; budget: NodeBudget }>;
        setModel: (nodeId: string, model: string) => Promise<{ ok: boolean }>;
        models: () => Promise<{ id: string; name: string }[]>;
        budget: (nodeId: string) => Promise<NodeBudget>;
        reset: (nodeId: string) => Promise<{ ok: boolean }>;
        onEvent: (cb: (e: CanvasEvent) => void) => () => void;
      };
      settings: {
        get: () => Promise<SettingsPayload>;
        set: (patch: any) => Promise<{ ok: boolean; appearance: any }>;
        setKey: (plain: string) => Promise<{ ok: boolean; encrypted: boolean }>;
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
      workspaces: {
        list: () => Promise<WorkspaceMeta[]>;
        create: (name?: string) => Promise<WorkspaceMeta>;
        rename: (id: string, name: string) => Promise<{ ok: boolean }>;
        delete: (id: string) => Promise<{ ok: boolean }>;
        pin: (id: string, pinned: boolean) => Promise<{ ok: boolean }>;
      };
      onMenu: (cb: (action: string) => void) => () => void;
    };
  }
}
