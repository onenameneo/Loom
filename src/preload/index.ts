import { contextBridge, ipcRenderer } from "electron";

type CanvasEvent = { nodeId: string; type: string; payload?: unknown };
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

const api = {
  platform: process.platform,
  lifecycle: {
    ready: () => ipcRenderer.send("renderer:ready"),
  },
  canvas: {
    list: (sessionId: string): Promise<any[]> => ipcRenderer.invoke("node:list", sessionId),
    open: (sessionId: string): Promise<any[]> => ipcRenderer.invoke("node:open", sessionId),
    create: (arg: { sessionId: string; parentId?: string; seed?: any; title?: string; includeParentContext?: boolean }): Promise<any> =>
      ipcRenderer.invoke("node:create", arg),
    send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[], skillIds?: string[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:send", { nodeId, text, images, skillIds }),
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
    models: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke("node:models"),
    budget: (nodeId: string): Promise<{ withoutAncestors: number; withAncestors: number; estimated: boolean }> =>
      ipcRenderer.invoke("node:budget", nodeId),
    trace: (nodeId: string): Promise<any> => ipcRenderer.invoke("node:trace", nodeId),
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
  },
  settings: {
    get: (): Promise<any> => ipcRenderer.invoke("settings:get"),
    set: (patch: any): Promise<any> => ipcRenderer.invoke("settings:set", patch),
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
    pickSourceRoot: (): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke("project:pickSourceRoot"),
  },
  sessions: {
    list: (projectId: string): Promise<any[]> => ipcRenderer.invoke("session:list", projectId),
    create: (projectId: string, title?: string): Promise<any> =>
      ipcRenderer.invoke("session:create", { projectId, title }),
    rename: (id: string, title: string): Promise<any> =>
      ipcRenderer.invoke("session:rename", { id, title }),
    delete: (id: string): Promise<any> => ipcRenderer.invoke("session:delete", id),
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
