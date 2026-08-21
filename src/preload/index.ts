import { contextBridge, ipcRenderer } from "electron";
import type { FileMentionRef } from "../common/fileMentions";
import type { ComposerBudgetPreviewInput } from "../common/composerBudget";
import type { SelectionContextNote } from "../common/selectionContext";
import type { AgentMetricTotals } from "../common/telemetry";
import type { McpConfigInput, McpSafeServerDto, McpSettingsSnapshot } from "../common/mcp";
import {
  parseFileListResult,
  parseFilePreviewResult,
  parseFileSearchResult,
  type FileListResult,
  type FilePreviewResult,
  type FileSearchRequest,
  type FileSearchResult,
  type FileWorkspaceRequest,
} from "../common/filePreview";

type CanvasEvent = { nodeId: string; type: string; payload?: unknown };
type LiveTurnSnapshot = { nodeId: string; sessionId: string; turnId: string; operation: "send" | "regenerate" | "edit-resend"; state: "running" | "awaiting_approval"; revision: number; assistantText: string; approval?: { requestId: string; toolName: string; toolCallId: string; reason?: string; sandboxMode?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "untrusted" | "on-request" | "never" } };
type LiveTurnEvent = { type: "upsert"; snapshot: LiveTurnSnapshot } | { type: "remove"; nodeId: string; revision: number };
type ApprovalScope = "once" | "node-session" | "persistent";
type ApprovalDecision = {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  action: "allow" | "deny";
  scope?: ApprovalScope;
};
type AgentProc = {
  pid: number;
  tool: "codex" | "claude";
  cwd?: string;
  project?: string;
  startedAt: number;
  cpu: number;
  status: "running" | "idle";
};
type MonitorEvent = { type: "snapshot" | "started" | "stopped"; agents: AgentProc[]; agent?: AgentProc };
type ActivityEvent = {
  id: string;
  tool: "claude" | "codex";
  sessionId: string;
  cwd?: string;
  project?: string;
  kind: "tool" | "permission" | "turn_end" | "session_start" | "stop" | "notification";
  title: string;
  detail?: string;
  ts: number;
};
type ActivitySession = {
  key: string;
  tool: "claude" | "codex";
  sessionId: string;
  cwd?: string;
  project?: string;
  lastActiveAt: number;
  eventCount: number;
  events: ActivityEvent[];
};
type ActivityTool = "claude" | "codex";
type ActivityConfigArg = { tools?: ActivityTool[] };
type AcpSessionDto = {
  id: string;
  cwd: string;
  project: string;
  status: "starting" | "ready" | "thinking" | "error" | "stopped";
  error?: string;
};
type AcpEvent = {
  type: "started" | "update" | "permission" | "error" | "stopped";
  sessionId?: string;
  [key: string]: unknown;
};
type MemoryRecordDto = {
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
};
type MemoryEvent = { type: "changed" | "extraction" | "autodream"; [key: string]: unknown };

const api = {
  platform: process.platform,
  lifecycle: {
    ready: () => ipcRenderer.send("renderer:ready"),
  },
  canvas: {
    list: (sessionId: string): Promise<any[]> => ipcRenderer.invoke("node:list", sessionId),
    plan: (nodeId: string): Promise<any> => ipcRenderer.invoke("node:plan", nodeId),
    open: (sessionId: string): Promise<any[]> => ipcRenderer.invoke("node:open", sessionId),
    create: (arg: { sessionId: string; parentId?: string; seed?: any; title?: string; includeParentContext?: boolean }): Promise<any> =>
      ipcRenderer.invoke("node:create", arg),
    branchFromMessage: (arg: { nodeId: string; sourceSeq: number; mode: "new-session" | "canvas-node" }): Promise<any> =>
      ipcRenderer.invoke("node:branchFromMessage", arg),
    send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[], skillIds?: string[], mentions?: FileMentionRef[], selectionNotes?: SelectionContextNote[]): Promise<{ ok: boolean; recovered?: "overflow"; reason?: string; errors?: Array<{ root: string; path: string; code: string; message: string }> }> =>
      ipcRenderer.invoke("node:send", { nodeId, text, images, skillIds, mentions, selectionNotes }),
    fileCandidates: (nodeId: string, query?: string): Promise<{ ok: boolean; candidates?: Array<{ root: string; rootName: string; path: string; kind: "file" }>; reason?: string }> =>
      ipcRenderer.invoke("node:fileCandidates", { nodeId, query }),
    abort: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:abort", nodeId),
    compact: (nodeId: string): Promise<{ ok: boolean; node?: any; reason?: string; error?: string }> => ipcRenderer.invoke("node:compact", nodeId),
    regenerate: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:regenerate", nodeId),
    editResend: (arg: { nodeId: string; seq: number; text: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:editResend", arg),
    delete: (nodeId: string): Promise<{ ok: boolean; deletedIds: string[] }> =>
      ipcRenderer.invoke("node:delete", nodeId),
    setSystemPrompt: (nodeId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:setSystemPrompt", { nodeId, text }),
    update: (nodeId: string, patch: { title?: string; color?: string }): Promise<{ ok: boolean; node?: any }> =>
      ipcRenderer.invoke("node:update", { nodeId, ...patch }),
    updateLayout: (nodeId: string, layout: { x: number; y: number; width: number; height: number }): Promise<any> =>
      ipcRenderer.invoke("node:updateLayout", { nodeId, layout }),
    updateLayouts: (items: Array<{ id: string; layout: { x: number; y: number; width: number; height: number } }>): Promise<any> =>
      ipcRenderer.invoke("node:updateLayouts", items),
    setModel: (nodeId: string, model: string | { providerId: string; modelId: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:setModel", { nodeId, model }),
    setThinkingLevel: (nodeId: string, thinkingLevel: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:setThinkingLevel", { nodeId, thinkingLevel }),
    models: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke("node:models"),
    budget: (nodeId: string, preview?: ComposerBudgetPreviewInput): Promise<{
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
      diagnostic?: string;
      preview?: { files: number; images: number; skills: number; selectionNotes?: number; selectionError?: string; errors?: Array<{ root: string; path: string; code: string; message: string }> };
    }> =>
      ipcRenderer.invoke("node:budget", preview ? { nodeId, preview } : nodeId),
    trace: (nodeId: string): Promise<any> => ipcRenderer.invoke("node:trace", nodeId),
    metrics: (nodeId: string): Promise<AgentMetricTotals | undefined> => ipcRenderer.invoke("node:metrics", nodeId),
    onTrace: (listener: (snapshot: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: any) => listener(snapshot);
      ipcRenderer.on("node:trace:update", handler);
      return () => ipcRenderer.removeListener("node:trace:update", handler);
    },
    reset: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:reset", nodeId),
    skills: (nodeId: string): Promise<any> => ipcRenderer.invoke("node:skills", nodeId),
    enableSkill: (nodeId: string, skillId: string): Promise<any> =>
      ipcRenderer.invoke("node:enableSkill", { nodeId, skillId }),
    disableSkill: (nodeId: string, skillId: string): Promise<any> =>
      ipcRenderer.invoke("node:disableSkill", { nodeId, skillId }),
    decideApproval: (decision: ApprovalDecision): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke("approval:decide", decision),
    onEvent: (cb: (e: CanvasEvent) => void) => {
      const l = (_: unknown, d: CanvasEvent) => cb(d);
      ipcRenderer.on("canvas:event", l);
      return () => ipcRenderer.removeListener("canvas:event", l);
    },
    liveTurns: (): Promise<LiveTurnSnapshot[]> => ipcRenderer.invoke("turns:list"),
    onLiveTurn: (cb: (event: LiveTurnEvent) => void) => {
      const l = (_: unknown, event: LiveTurnEvent) => cb(event);
      ipcRenderer.on("canvas:live-turn", l);
      return () => ipcRenderer.removeListener("canvas:live-turn", l);
    },
  },
  settings: {
    get: (): Promise<any> => ipcRenderer.invoke("settings:get"),
    set: (patch: any): Promise<any> => ipcRenderer.invoke("settings:set", patch),
    setLocale: (locale: "zh-CN" | "en"): void => ipcRenderer.send("settings:locale", locale),
    getPermissions: (): Promise<any> => ipcRenderer.invoke("settings:getPermissions"),
    setPermissions: (patch: any): Promise<any> => ipcRenderer.invoke("settings:setPermissions", patch),
    setGlobalModel: (model: { providerId: string; modelId: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("settings:setGlobalModel", model),
    addProviderModel: (input: any): Promise<{ ok: boolean }> => ipcRenderer.invoke("settings:addProviderModel", input),
    deleteProviderModel: (model: { providerId: string; modelId: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("settings:deleteProviderModel", model),
    openModelsJson: (): Promise<{ ok: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke("settings:openModelsJson"),
    skills: (projectId?: string): Promise<any> => ipcRenderer.invoke("settings:skills", projectId),
    addSkillSource: (path: string): Promise<any> => ipcRenderer.invoke("settings:addSkillSource", path),
    removeSkillSource: (path: string): Promise<any> => ipcRenderer.invoke("settings:removeSkillSource", path),
    openSkillSource: (path: string): Promise<any> => ipcRenderer.invoke("settings:openSkillSource", path),
  },
  mcp: {
    list: (): Promise<McpSettingsSnapshot> => ipcRenderer.invoke("mcp:list"),
    get: (id: string): Promise<McpSafeServerDto | undefined> => ipcRenderer.invoke("mcp:get", { id }),
    save: (config: McpConfigInput): Promise<{ ok: boolean; config?: McpConfigInput; issues?: Array<{ code: string; path: string; message: string }> }> => ipcRenderer.invoke("mcp:save", { config }),
    remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("mcp:remove", { id }),
    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean; config?: McpConfigInput }> => ipcRenderer.invoke("mcp:setEnabled", { id, enabled }),
    consent: (id: string, revision: number): Promise<{ ok: boolean; status: unknown }> => ipcRenderer.invoke("mcp:consent", { id, revision }),
    test: (id: string, consented?: boolean): Promise<{ ok: boolean; status: unknown; catalog?: { revision: number; toolCount: number } }> => ipcRenderer.invoke("mcp:test", { id, consented }),
    reconnect: (id: string, consented?: boolean): Promise<{ ok: boolean; status: unknown; catalog?: { revision: number; toolCount: number } }> => ipcRenderer.invoke("mcp:reconnect", { id, consented }),
    refresh: (id: string, consented?: boolean): Promise<{ ok: boolean; status: unknown; catalog?: { revision: number; toolCount: number } }> => ipcRenderer.invoke("mcp:refresh", { id, consented }),
    onStatus: (listener: (status: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on("mcp:status", handler);
      return () => ipcRenderer.removeListener("mcp:status", handler);
    },
  },
  monitor: {
    list: (): Promise<AgentProc[]> => ipcRenderer.invoke("monitor:list"),
    onEvent: (cb: (e: MonitorEvent) => void) => {
      const l = (_: unknown, d: MonitorEvent) => cb(d);
      ipcRenderer.on("monitor:event", l);
      return () => ipcRenderer.removeListener("monitor:event", l);
    },
    setNotify: (on: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke("monitor:setNotify", on),
  },
  activity: {
    list: (): Promise<ActivitySession[]> => ipcRenderer.invoke("activity:list"),
    status: (): Promise<any> => ipcRenderer.invoke("activity:status"),
    enable: (arg: ActivityConfigArg): Promise<any> => ipcRenderer.invoke("activity:enable", arg),
    disable: (arg: ActivityConfigArg): Promise<any> => ipcRenderer.invoke("activity:disable", arg),
    onEvent: (cb: (e: ActivityEvent) => void) => {
      const l = (_: unknown, d: ActivityEvent) => cb(d);
      ipcRenderer.on("activity:event", l);
      return () => ipcRenderer.removeListener("activity:event", l);
    },
  },
  memory: {
    list: (arg?: { projectId?: string; includeArchived?: boolean }): Promise<{ records: MemoryRecordDto[]; issues: Array<{ path: string; message: string }>; stats: any }> =>
      ipcRenderer.invoke("memory:list", arg),
    stats: (): Promise<any> => ipcRenderer.invoke("memory:stats"),
    preview: (id: string): Promise<any> => ipcRenderer.invoke("memory:preview", id),
    remember: (input: any): Promise<MemoryRecordDto> => ipcRenderer.invoke("memory:remember", input),
    edit: (arg: { id: string; patch: any }): Promise<MemoryRecordDto | undefined> => ipcRenderer.invoke("memory:edit", arg),
    archive: (id: string, reason?: string): Promise<MemoryRecordDto | undefined> => ipcRenderer.invoke("memory:archive", { id, reason }),
    forget: (id: string, reason?: string): Promise<MemoryRecordDto | undefined> => ipcRenderer.invoke("memory:forget", { id, reason }),
    approve: (id: string, overrides?: any): Promise<MemoryRecordDto | undefined> => ipcRenderer.invoke("memory:approve", { id, overrides }),
    reject: (id: string, reason?: string): Promise<MemoryRecordDto | undefined> => ipcRenderer.invoke("memory:reject", { id, reason }),
    autodreamStatus: (): Promise<any> => ipcRenderer.invoke("memory:autodreamStatus"),
    autodreamRun: (): Promise<any> => ipcRenderer.invoke("memory:autodreamRun"),
    autodreamCancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("memory:autodreamCancel"),
    onEvent: (cb: (event: MemoryEvent) => void) => {
      const l = (_: unknown, event: MemoryEvent) => cb(event);
      ipcRenderer.on("memory:event", l);
      return () => ipcRenderer.removeListener("memory:event", l);
    },
  },
  acp: {
    start: (arg: { cwd: string }): Promise<{ ok: boolean; sessionId?: string; message?: string; hint?: string }> =>
      ipcRenderer.invoke("acp:start", arg),
    prompt: (arg: { sessionId: string; text: string }): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke("acp:prompt", arg),
    cancel: (sessionId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke("acp:cancel", { sessionId }),
    stop: (sessionId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("acp:stop", { sessionId }),
    respondPermission: (arg: { sessionId: string; requestId: string; optionId?: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("acp:respondPermission", arg),
    pickDir: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke("acp:pickDir"),
    list: (): Promise<AcpSessionDto[]> => ipcRenderer.invoke("acp:list"),
    onEvent: (cb: (e: AcpEvent) => void) => {
      const l = (_: unknown, d: AcpEvent) => cb(d);
      ipcRenderer.on("acp:event", l);
      return () => ipcRenderer.removeListener("acp:event", l);
    },
  },
  projects: {
    list: (): Promise<any[]> => ipcRenderer.invoke("project:list"),
    create: (input?: string | { name?: string; sourceRoots?: string[] }): Promise<any> => ipcRenderer.invoke("project:create", input),
    rename: (id: string, name: string): Promise<any> =>
      ipcRenderer.invoke("project:rename", { id, name }),
    delete: (id: string): Promise<any> => ipcRenderer.invoke("project:delete", id),
    pin: (id: string, pinned: boolean): Promise<any> =>
      ipcRenderer.invoke("project:pin", { id, pinned }),
    updateUi: (id: string, ui: { activeSessionId?: string }): Promise<any> =>
      ipcRenderer.invoke("project:updateUi", { id, ui }),
    pickSourceRoot: (): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke("project:pickSourceRoot"),
  },
  files: {
    list: async (request: FileWorkspaceRequest): Promise<FileListResult> =>
      parseFileListResult(await ipcRenderer.invoke("file:list", request)),
    search: async (request: FileSearchRequest): Promise<FileSearchResult> =>
      parseFileSearchResult(await ipcRenderer.invoke("file:search", request)),
    preview: async (request: FileWorkspaceRequest): Promise<FilePreviewResult> =>
      parseFilePreviewResult(await ipcRenderer.invoke("file:preview", request)),
    open: (request: FileWorkspaceRequest): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke("file:open", request),
  },
  sessions: {
    list: (projectId: string): Promise<any[]> => ipcRenderer.invoke("session:list", projectId),
    create: (projectId: string, title?: string): Promise<any> =>
      ipcRenderer.invoke("session:create", { projectId, title }),
    rename: (id: string, title: string): Promise<any> =>
      ipcRenderer.invoke("session:rename", { id, title }),
    delete: (id: string): Promise<any> => ipcRenderer.invoke("session:delete", id),
    updateUi: (id: string, ui: { activeNodeId?: string; mode?: "chat" | "canvas" }): Promise<any> =>
      ipcRenderer.invoke("session:updateUi", { id, ui }),
  },
  onMenu: (cb: (action: string) => void) => {
    const l = (_: unknown, action: string) => cb(action);
    ipcRenderer.on("menu:action", l);
    return () => ipcRenderer.removeListener("menu:action", l);
  },
  onFullScreen: (cb: (fullscreen: boolean) => void) => {
    const l = (_: unknown, fullscreen: boolean) => cb(fullscreen);
    ipcRenderer.on("window:fullscreen", l);
    return () => ipcRenderer.removeListener("window:fullscreen", l);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type CanvasApi = typeof api;
