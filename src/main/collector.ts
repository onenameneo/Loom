import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { BrowserWindow, ipcMain } from "electron";
import type { Store } from "./store/store";

const DEFAULT_PORT = 31_577;
const MAX_PORT_PROBES = 32;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS_PER_SESSION = 200;
const LOOM_MARK = "loom-agent-activity-stream";
const CLAUDE_EVENTS = ["PostToolUse", "Notification", "Stop", "SessionStart"] as const;

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

type ActivityScope = "project" | "global";
type ActivityEnableTool = ActivityTool;
type ActivityConfigArg = {
  scope?: ActivityScope;
  tools?: ActivityEnableTool[];
};
type ToolStatus = {
  enabled: boolean;
  path: string;
  conflict?: string;
};
export type ActivityStatus = {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  scopes: Record<ActivityScope, Record<ActivityEnableTool, ToolStatus>>;
};
type ConfigResult = {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  changed: string[];
  conflicts: { tool: ActivityEnableTool; path: string; message: string }[];
  status: ActivityStatus;
};

function projectRoot(): string {
  return resolve(process.cwd());
}

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || projectRoot();
}

function tokenPreview(token: string): string {
  return token.length <= 8 ? token : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function ensureToken(store: Store): string {
  const existing = store.getSettings().activity.token;
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  store.patchSettings({ activity: { token } });
  return token;
}

function savePort(store: Store, port: number) {
  if (store.getSettings().activity.port !== port) store.patchSettings({ activity: { port } });
}

function readJsonObject(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObject(file: string, value: Record<string, any>) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

function writeText(file: string, value: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value, "utf-8");
}

function pathsFor(scope: ActivityScope) {
  const root = scope === "global" ? homeDir() : projectRoot();
  return {
    claude: join(root, ".claude", scope === "global" ? "settings.json" : "settings.local.json"),
    codex: join(root, ".codex", "config.toml"),
  };
}

function allFiles(): string[] {
  return [
    pathsFor("project").claude,
    pathsFor("project").codex,
    pathsFor("global").claude,
    pathsFor("global").codex,
  ];
}

function forwarderPath(): string {
  return join(projectRoot(), "scripts", "codex-notify-forward.mjs");
}

function normalizeTools(tools?: ActivityEnableTool[]): ActivityEnableTool[] {
  const selected = tools?.filter((tool): tool is ActivityEnableTool => tool === "claude" || tool === "codex");
  return selected?.length ? [...new Set(selected)] : ["claude", "codex"];
}

function normalizeScope(scope?: ActivityScope): ActivityScope {
  return scope === "global" ? "global" : "project";
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compact(value: unknown, max = 420): string | undefined {
  if (value == null) return undefined;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function requestHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasValidToken(req: IncomingMessage, token: string): boolean {
  return requestHeader(req, "authorization") === `Bearer ${token}`;
}

function jsonResponse(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function eventTarget(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  const candidates = [
    input.file_path,
    input.path,
    input.command,
    input.pattern,
    input.url,
    input.description,
  ];
  return compact(candidates.find((item) => typeof item === "string"), 90);
}

function normalizeClaude(payload: unknown): ActivityEvent | null {
  if (!isObject(payload)) return null;
  const sessionId = compact(payload.session_id, 120);
  if (!sessionId) return null;
  const eventName = compact(payload.hook_event_name, 80);
  const cwd = compact(payload.cwd, 400);
  const toolName = compact(payload.tool_name, 80);
  let kind: ActivityKind = "notification";
  let title = eventName || "Claude activity";
  let detail: string | undefined;

  if (eventName === "PostToolUse") {
    kind = "tool";
    const target = eventTarget(payload.tool_input);
    title = target ? `${toolName || "Tool"} ${target}` : toolName || "Tool used";
    detail = compact(payload.tool_output ?? payload.output ?? payload.tool_input);
  } else if (eventName === "Notification") {
    const matcher = compact(payload.matcher, 80) || compact(payload.notification_type, 80);
    kind = matcher === "permission_prompt" ? "permission" : "notification";
    title = kind === "permission" ? `需要批准: ${toolName || "Claude"}` : "Claude 通知";
    detail = compact(payload.message ?? payload.tool_input ?? payload.permission_mode);
  } else if (eventName === "Stop" || eventName === "SubagentStop") {
    kind = "stop";
    title = eventName === "SubagentStop" ? "Subagent 结束" : "会话结束";
    detail = compact(payload.stop_hook_active ? "stop hook active" : undefined);
  } else if (eventName === "SessionStart") {
    kind = "session_start";
    title = "会话开始";
    detail = compact(payload.source ?? payload.permission_mode);
  }

  return {
    id: nextEventId(),
    tool: "claude",
    sessionId,
    cwd,
    project: cwd ? basename(cwd) : undefined,
    kind,
    title,
    detail,
    ts: Date.now(),
  };
}

function normalizeCodex(payload: unknown): ActivityEvent | null {
  if (!isObject(payload)) return null;
  const type = compact(payload.type, 80);
  if (type && type !== "agent-turn-complete") return null;
  const sessionId = compact(payload["thread-id"] ?? payload.threadId, 120);
  if (!sessionId) return null;
  const cwd = compact(payload.cwd, 400);
  return {
    id: nextEventId(),
    tool: "codex",
    sessionId,
    cwd,
    project: cwd ? basename(cwd) : undefined,
    kind: "turn_end",
    title: "回合完成",
    detail: compact(payload["last-assistant-message"] ?? payload.lastAssistantMessage),
    ts: Date.now(),
  };
}

let eventSeq = 0;
function nextEventId(): string {
  eventSeq += 1;
  return `act_${Date.now().toString(36)}_${eventSeq.toString(36)}`;
}

function loomClaudeHook(port: number, token: string) {
  return {
    type: "http",
    url: `http://127.0.0.1:${port}/claude`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Loom": LOOM_MARK,
    },
  };
}

function isLoomClaudeHook(value: unknown): boolean {
  return (
    isObject(value) &&
    value.type === "http" &&
    typeof value.url === "string" &&
    value.url.includes("/claude") &&
    isObject(value.headers) &&
    value.headers["X-Loom"] === LOOM_MARK
  );
}

function ensureClaudeEnabled(file: string, port: number, token: string): boolean {
  const settings = readJsonObject(file);
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  let changed = settings.hooks !== hooks;
  const hook = loomClaudeHook(port, token);

  for (const name of CLAUDE_EVENTS) {
    const current = Array.isArray(hooks[name]) ? hooks[name] : [];
    const withoutOld = current.filter((item: unknown) => !isLoomClaudeHook(item));
    const next = [...withoutOld, hook];
    if (current.length !== next.length || !current.some(isLoomClaudeHook)) changed = true;
    hooks[name] = next;
  }

  settings.hooks = hooks;
  if (changed || !existsSync(file)) writeJsonObject(file, settings);
  return changed || !existsSync(file);
}

function disableClaude(file: string): boolean {
  if (!existsSync(file)) return false;
  const settings = readJsonObject(file);
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  let changed = false;
  for (const name of CLAUDE_EVENTS) {
    if (!Array.isArray(hooks[name])) continue;
    const next = hooks[name].filter((item: unknown) => !isLoomClaudeHook(item));
    if (next.length !== hooks[name].length) {
      changed = true;
      if (next.length) hooks[name] = next;
      else delete hooks[name];
    }
  }
  if (changed) writeJsonObject(file, settings);
  return changed;
}

function isClaudeEnabled(file: string): boolean {
  if (!existsSync(file)) return false;
  const hooks = readJsonObject(file).hooks;
  return isObject(hooks) && CLAUDE_EVENTS.every((name) => Array.isArray(hooks[name]) && hooks[name].some(isLoomClaudeHook));
}

function notifyArray(port: number, token: string): string[] {
  return ["node", forwarderPath(), token, String(port)];
}

function isSameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function parseTomlStringArray(source: string): string[] | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try {
    const jsonish = trimmed.replace(/'/g, '"');
    const parsed = JSON.parse(jsonish);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function formatTomlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function findNotifyLine(text: string): { line: number; value: string; arr: string[] | null } | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*notify\s*=\s*(.+?)\s*$/);
    if (match) return { line: i, value: match[1], arr: parseTomlStringArray(match[1]) };
  }
  return null;
}

function isLoomNotify(arr: string[] | null): boolean {
  return Boolean(arr && arr[0] === "node" && arr[1] === forwarderPath() && arr.length >= 4);
}

function ensureCodexEnabled(file: string, port: number, token: string): { changed: boolean; conflict?: string } {
  const existing = readText(file);
  const lines = existing ? existing.split(/\r?\n/) : [];
  const notify = findNotifyLine(existing);
  const nextArr = notifyArray(port, token);
  const nextLine = `notify = ${formatTomlArray(nextArr)}`;

  if (notify) {
    if (!isLoomNotify(notify.arr)) return { changed: false, conflict: "Codex notify 已存在且不是 Loom 写入，未覆盖。" };
    if (isSameArray(notify.arr ?? [], nextArr)) return { changed: false };
    lines[notify.line] = nextLine;
    writeText(file, `${lines.join("\n").replace(/\n*$/, "")}\n`);
    return { changed: true };
  }

  lines.push(nextLine);
  writeText(file, `${lines.join("\n").replace(/^\n+|\n*$/g, "")}\n`);
  return { changed: true };
}

function disableCodex(file: string): boolean {
  if (!existsSync(file)) return false;
  const text = readText(file);
  const lines = text.split(/\r?\n/);
  const notify = findNotifyLine(text);
  if (!notify || !isLoomNotify(notify.arr)) return false;
  lines.splice(notify.line, 1);
  writeText(file, `${lines.join("\n").replace(/\n*$/, "")}\n`);
  return true;
}

function codexStatus(file: string): ToolStatus {
  const notify = findNotifyLine(readText(file));
  if (!notify) return { enabled: false, path: file };
  if (isLoomNotify(notify.arr)) return { enabled: true, path: file };
  return { enabled: false, path: file, conflict: "Codex notify 已被其它命令占用。" };
}

function buildStatus(port: number, token: string): ActivityStatus {
  return {
    ok: true,
    port,
    tokenPreview: tokenPreview(token),
    files: allFiles(),
    scopes: {
      project: {
        claude: { enabled: isClaudeEnabled(pathsFor("project").claude), path: pathsFor("project").claude },
        codex: codexStatus(pathsFor("project").codex),
      },
      global: {
        claude: { enabled: isClaudeEnabled(pathsFor("global").claude), path: pathsFor("global").claude },
        codex: codexStatus(pathsFor("global").codex),
      },
    },
  };
}

function listen(server: Server, startPort: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    let port = startPort;
    let attempts = 0;
    const tryPort = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && attempts < MAX_PORT_PROBES) {
          attempts += 1;
          port += 1;
          tryPort();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListen(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

export function registerCollector(opts: { getWin: () => BrowserWindow | null; store: Store }) {
  const { getWin, store } = opts;
  const token = ensureToken(store);
  let port = store.getSettings().activity.port || DEFAULT_PORT;
  const sessions = new Map<string, ActivitySession>();
  let stopped = false;

  function snapshot(): ActivitySession[] {
    return [...sessions.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  function send(event: ActivityEvent) {
    getWin()?.webContents.send("activity:event", event);
  }

  function addEvent(event: ActivityEvent) {
    const key = `${event.tool}:${event.sessionId}`;
    const existing = sessions.get(key);
    const next: ActivitySession = existing ?? {
      key,
      tool: event.tool,
      sessionId: event.sessionId,
      cwd: event.cwd,
      project: event.project,
      lastActiveAt: event.ts,
      eventCount: 0,
      events: [],
    };
    next.cwd = event.cwd || next.cwd;
    next.project = event.project || next.project;
    next.lastActiveAt = event.ts;
    next.eventCount += 1;
    next.events = [...next.events, event].slice(-MAX_EVENTS_PER_SESSION);
    sessions.set(key, next);
    send(event);
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse, tool: ActivityTool) {
    if (!hasValidToken(req, token)) {
      jsonResponse(res, 401);
      return;
    }
    try {
      const body = await readBody(req);
      const event = tool === "claude" ? normalizeClaude(body) : normalizeCodex(body);
      if (event) addEvent(event);
      jsonResponse(res, 200);
    } catch {
      jsonResponse(res, 200);
    }
  }

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/claude") {
      void handlePost(req, res, "claude");
      return;
    }
    if (req.method === "POST" && req.url === "/codex") {
      void handlePost(req, res, "codex");
      return;
    }
    jsonResponse(res, 404);
  });

  void listen(server, port)
    .then((actualPort) => {
      port = actualPort;
      savePort(store, port);
      console.log(`[collector] listening on 127.0.0.1:${port}`);
    })
    .catch((err) => console.log("[collector] failed to listen:", (err as Error)?.message ?? err));

  ipcMain.handle("activity:list", () => snapshot());
  ipcMain.handle("activity:status", () => buildStatus(port, token));
  ipcMain.handle("activity:enable", (_e, arg?: ActivityConfigArg): ConfigResult => {
    const scope = normalizeScope(arg?.scope);
    const tools = normalizeTools(arg?.tools);
    const files = pathsFor(scope);
    const changed: string[] = [];
    const conflicts: ConfigResult["conflicts"] = [];

    if (tools.includes("claude") && ensureClaudeEnabled(files.claude, port, token)) changed.push(files.claude);
    if (tools.includes("codex")) {
      const result = ensureCodexEnabled(files.codex, port, token);
      if (result.changed) changed.push(files.codex);
      if (result.conflict) conflicts.push({ tool: "codex", path: files.codex, message: result.conflict });
    }

    return {
      ok: conflicts.length === 0,
      port,
      tokenPreview: tokenPreview(token),
      files: tools.map((tool) => files[tool]),
      changed,
      conflicts,
      status: buildStatus(port, token),
    };
  });
  ipcMain.handle("activity:disable", (_e, arg?: ActivityConfigArg): ConfigResult => {
    const scope = normalizeScope(arg?.scope);
    const tools = normalizeTools(arg?.tools);
    const files = pathsFor(scope);
    const changed: string[] = [];
    const conflicts: ConfigResult["conflicts"] = [];

    if (tools.includes("claude") && disableClaude(files.claude)) changed.push(files.claude);
    if (tools.includes("codex") && disableCodex(files.codex)) changed.push(files.codex);

    return {
      ok: true,
      port,
      tokenPreview: tokenPreview(token),
      files: tools.map((tool) => files[tool]),
      changed,
      conflicts,
      status: buildStatus(port, token),
    };
  });

  function stop() {
    stopped = true;
    if (server.listening) server.close();
    ipcMain.removeHandler("activity:list");
    ipcMain.removeHandler("activity:status");
    ipcMain.removeHandler("activity:enable");
    ipcMain.removeHandler("activity:disable");
  }

  return {
    stop,
    get stopped() {
      return stopped;
    },
  };
}
