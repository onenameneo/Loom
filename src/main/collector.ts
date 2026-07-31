import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { app, BrowserWindow, Notification, ipcMain } from "electron";
import type { Store } from "./store/store";
import { sendToWindow } from "./ipcSafeSend";

const DEFAULT_PORT = 31_577;
const MAX_PORT_PROBES = 32;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS_PER_SESSION = 200;
const LOOM_MARK = "loom-agent-activity-stream";
const CLAUDE_EVENTS = ["PostToolUse", "Notification", "Stop", "SubagentStop", "SessionStart"] as const;
// Codex 的事件集与 Claude 不完全对称：它有独立的 PermissionRequest，
// 而不是 Claude 那种「Notification + permission_prompt matcher」。
// 见 https://learn.chatgpt.com/docs/hooks
const CODEX_EVENTS = ["PostToolUse", "PermissionRequest", "Stop", "SubagentStop", "SessionStart"] as const;
// Codex hook 同步阻塞回合，这是兜底上限（秒）。省略时 Codex 默认 600s，太长。
const CODEX_HOOK_TIMEOUT_SEC = 5;
const CODEX_HOOK_STATUS = "Loom 活动流";

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
  // 折叠相邻同名工具事件需要可靠依据；title 是拼过的展示串，不能拿来分组。
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

type ActivityEnableTool = ActivityTool;
type ActivityConfigArg = {
  tools?: ActivityEnableTool[];
};
type ToolStatus = {
  // 配置文件里有 Loom 的条目 —— 只代表意图，不代表在工作。
  configured: boolean;
  // 首次真实收到该工具事件的时刻；有值才等于「真的接上了」。
  verifiedAt?: number;
  lastEventAt?: number;
  path: string;
  // 配置已写好、但仍需用户在工具里做一步动作才会生效（Codex 的 /hooks 信任）。
  actionRequired?: string;
};
export type ActivityStatus = {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  tools: Record<ActivityEnableTool, ToolStatus>;
};
type ConfigNote = { tool: ActivityEnableTool; path: string; message: string };
type ConfigResult = {
  ok: boolean;
  port: number;
  tokenPreview: string;
  files: string[];
  changed: string[];
  conflicts: ConfigNote[];
  // 写入成功、但还差用户在工具侧的一步（目前只有 Codex 的 /hooks 信任）。
  notes: ConfigNote[];
  status: ActivityStatus;
};

// Loom 自身的安装位置 —— 用来定位随应用分发的 forwarder 脚本。
// 必须与「被观察的工作目录」区分开：cwd 在打包后的 Electron 里不可控，
// 而 forwarder 的绝对路径是 Codex hook 命令字符串的一部分，路径一漂移，
// 哈希就变，用户就得重新 /hooks 信任一次。
// 注意：将来接入 electron-builder 时，scripts/ 必须 asar-unpack（asar 内的
// 文件没法被外部 node 执行）。
function appRoot(): string {
  return resolve(app.getAppPath());
}

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || resolve(process.cwd());
}

// forwarder 在运行时从这里读 port/token，而不是从命令行参数拿。
// 这样 hook 的命令字符串恒定，端口探测或 token 轮换都不会让信任失效。
function endpointFile(): string {
  return join(homeDir(), ".loom", "collector.json");
}

function writeEndpointFile(port: number, token: string) {
  try {
    writeJsonObject(endpointFile(), { port, token });
  } catch (err) {
    console.log("[collector] failed to write endpoint file:", (err as Error)?.message ?? err);
  }
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

// 一律只写全局配置。观察哨的职责是盯住本机所有 agent，而项目级作用域只能
// 覆盖某一个仓库；对 Codex 更是死路 —— 实测 Codex 的项目级配置层既不认
// `notify`（启动时明确警告 "Ignored unsupported project-local config keys"），
// 也不加载 .codex/hooks.json（/hooks 里根本不列出、拿不到信任记录）。
function configPaths(): Record<ActivityEnableTool, string> {
  return {
    claude: join(homeDir(), ".claude", "settings.json"),
    codex: join(homeDir(), ".codex", "hooks.json"),
  };
}

// Loom 早期把 Codex 接在 config.toml 的 `notify` 上。notify 是单值键，
// 会和 Codex Computer Use 之类的既有通知链互斥，且只送 agent-turn-complete
// 一种事件。现在改用 hooks（跨层合并、永不互斥、事件粒度完整），
// 这个路径只用于清理迁移前的残留。
function legacyCodexConfig(): string {
  return join(homeDir(), ".codex", "config.toml");
}

function allFiles(): string[] {
  const paths = configPaths();
  return [paths.claude, paths.codex];
}

function hookForwarderPath(): string {
  return join(appRoot(), "scripts", "codex-hook-forward.mjs");
}

function normalizeTools(tools?: ActivityEnableTool[]): ActivityEnableTool[] {
  const selected = tools?.filter((tool): tool is ActivityEnableTool => tool === "claude" || tool === "codex");
  return selected?.length ? [...new Set(selected)] : ["claude", "codex"];
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

// Claude Code 与 Codex 的 hook 载荷字段同名（session_id / hook_event_name /
// tool_name / tool_input / cwd …），所以两边共用一个归一化器。
// 差异只有两处，在下面各自的分支里处理：
//   - 批准：Claude 是 Notification + permission_prompt matcher，Codex 是独立的 PermissionRequest
//   - 回合末尾的正文：Codex 的 Stop 带 last_assistant_message，Claude 不带
function normalizeHookEvent(tool: ActivityTool, payload: unknown): ActivityEvent | null {
  if (!isObject(payload)) return null;
  const sessionId = compact(payload.session_id, 120);
  if (!sessionId) return null;
  const eventName = compact(payload.hook_event_name, 80);
  const cwd = compact(payload.cwd, 400);
  const toolName = compact(payload.tool_name, 80);
  const toolLabel = tool === "claude" ? "Claude" : "Codex";
  let kind: ActivityKind = "notification";
  let title = eventName || `${toolLabel} activity`;
  let detail: string | undefined;

  if (eventName === "PostToolUse") {
    kind = "tool";
    const target = eventTarget(payload.tool_input);
    title = target ? `${toolName || "Tool"} ${target}` : toolName || "Tool used";
    detail = compact(payload.tool_output ?? payload.output ?? payload.tool_input);
  } else if (eventName === "PermissionRequest") {
    kind = "permission";
    title = `需要批准: ${toolName || toolLabel}`;
    detail = compact(payload.tool_input ?? payload.permission_mode);
  } else if (eventName === "Notification") {
    const matcher = compact(payload.matcher, 80) || compact(payload.notification_type, 80);
    kind = matcher === "permission_prompt" ? "permission" : "notification";
    title = kind === "permission" ? `需要批准: ${toolName || toolLabel}` : `${toolLabel} 通知`;
    detail = compact(payload.message ?? payload.tool_input ?? payload.permission_mode);
  } else if (eventName === "Stop" || eventName === "SubagentStop") {
    // Stop 在主 agent 答完每一轮时触发，不是会话退出。
    kind = eventName === "SubagentStop" ? "stop" : "turn_end";
    title = eventName === "SubagentStop" ? "Subagent 结束" : "回合结束";
    detail =
      compact(payload.last_assistant_message) ??
      compact(payload.stop_hook_active ? "stop hook active" : undefined);
  } else if (eventName === "SessionStart") {
    kind = "session_start";
    title = "会话开始";
    detail = compact(payload.source ?? payload.permission_mode);
  }

  return {
    id: nextEventId(),
    tool,
    sessionId,
    cwd,
    project: cwd ? basename(cwd) : undefined,
    kind,
    title,
    toolName: kind === "tool" ? toolName : undefined,
    detail,
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

// settings.json 里 hooks[事件] 的元素是「匹配器分组」而不是 hook 本身，
// 分组的 hooks 字段必须是数组 —— 缺了它 Claude Code 的 schema 校验会
// 报 "Expected array, but received undefined" 并丢弃整份 settings.json。
// 省略 matcher 表示匹配全部。
function loomClaudeGroup(port: number, token: string) {
  return { hooks: [loomClaudeHook(port, token)] };
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

function hasLoomClaudeGroup(entries: unknown[]): boolean {
  return entries.some((entry) => isObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some(isLoomClaudeHook));
}

// 清掉一个事件里所有 Loom 痕迹。除了正常的分组，还要认早期版本平铺写进
// 事件数组的裸 hook —— 那种记录正是让 settings.json 整份失效的元凶，
// 必须能被识别才清得掉。同时只摘走分组里的 Loom hook，保留用户自己的。
function stripLoomClaude(entries: unknown[]): unknown[] {
  const kept: unknown[] = [];
  for (const entry of entries) {
    if (isLoomClaudeHook(entry)) continue;
    if (isObject(entry) && Array.isArray(entry.hooks)) {
      const hooks = entry.hooks.filter((hook: unknown) => !isLoomClaudeHook(hook));
      if (!hooks.length) continue;
      if (hooks.length !== entry.hooks.length) {
        kept.push({ ...entry, hooks });
        continue;
      }
    }
    kept.push(entry);
  }
  return kept;
}

function ensureClaudeEnabled(file: string, port: number, token: string): boolean {
  const settings = readJsonObject(file);
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  let changed = settings.hooks !== hooks;
  const group = loomClaudeGroup(port, token);

  for (const name of CLAUDE_EVENTS) {
    const current = Array.isArray(hooks[name]) ? hooks[name] : [];
    const next = [...stripLoomClaude(current), group];
    // 必须按内容比对：isLoomClaudeHook 只认 X-Loom 标记、不看 port/token，
    // 所以「已存在一条指向旧端口的 Loom hook」在长度和存在性上都看不出差别。
    // 早先按长度比对会让端口探测（31577 被占 → 31578）后的重新启用静默 no-op，
    // 而状态照样报「已接入」—— hook 却在往死端口 POST。
    if (JSON.stringify(current) !== JSON.stringify(next)) changed = true;
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
    const next = stripLoomClaude(hooks[name]);
    if (JSON.stringify(next) !== JSON.stringify(hooks[name])) {
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
  return isObject(hooks) && CLAUDE_EVENTS.every((name) => Array.isArray(hooks[name]) && hasLoomClaudeGroup(hooks[name]));
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// 命令里刻意不带 port/token —— Codex 按命令字符串的哈希记账信任，
// 参数一变就要重新 /hooks 信任。port/token 由 forwarder 运行时从
// ~/.loom/collector.json 读。详见 scripts/codex-hook-forward.mjs。
function codexHookCommand(): string {
  return `node ${shQuote(hookForwarderPath())}`;
}

function loomCodexHook() {
  return {
    type: "command",
    command: codexHookCommand(),
    timeout: CODEX_HOOK_TIMEOUT_SEC,
    statusMessage: CODEX_HOOK_STATUS,
  };
}

function isLoomCodexHook(value: unknown): boolean {
  return isObject(value) && value.type === "command" && value.command === codexHookCommand();
}

function isLoomCodexGroup(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.hooks) && value.hooks.some(isLoomCodexHook);
}

function loomCodexGroup() {
  // matcher 省略 = 匹配全部工具。
  return { hooks: [loomCodexHook()] };
}

// Codex 的 hooks 跨配置层合并、不互相覆盖，所以这里永远不会和别人冲突
// ——这正是从 notify（单值键，会被 Codex Computer Use 之类占用）迁过来的原因。
function ensureCodexEnabled(file: string): boolean {
  const config = readJsonObject(file);
  const hooks = isObject(config.hooks) ? config.hooks : {};
  let changed = config.hooks !== hooks;

  for (const name of CODEX_EVENTS) {
    const current = Array.isArray(hooks[name]) ? hooks[name] : [];
    const withoutOld = current.filter((item: unknown) => !isLoomCodexGroup(item));
    const next = [...withoutOld, loomCodexGroup()];
    if (JSON.stringify(current) !== JSON.stringify(next)) changed = true;
    hooks[name] = next;
  }

  config.hooks = hooks;
  if (changed || !existsSync(file)) writeJsonObject(file, config);
  return changed || !existsSync(file);
}

function disableCodex(file: string): boolean {
  if (!existsSync(file)) return false;
  const config = readJsonObject(file);
  const hooks = isObject(config.hooks) ? config.hooks : {};
  let changed = false;
  for (const name of CODEX_EVENTS) {
    if (!Array.isArray(hooks[name])) continue;
    const next = hooks[name].filter((item: unknown) => !isLoomCodexGroup(item));
    if (next.length !== hooks[name].length) {
      changed = true;
      if (next.length) hooks[name] = next;
      else delete hooks[name];
    }
  }
  if (changed) writeJsonObject(file, config);
  return changed;
}

function isCodexEnabled(file: string): boolean {
  if (!existsSync(file)) return false;
  const hooks = readJsonObject(file).hooks;
  return isObject(hooks) && CODEX_EVENTS.every((name) => Array.isArray(hooks[name]) && hooks[name].some(isLoomCodexGroup));
}

// 迁移：抹掉 Loom 早期写在 config.toml 里的 notify 行。只删自己写的那条，
// 别人的（例如 Codex Computer Use 的）一律不碰。
function removeLegacyLoomNotify(file: string): boolean {
  if (!existsSync(file)) return false;
  const text = readText(file);
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex(
    (line) => /^\s*notify\s*=/.test(line) && line.includes("codex-notify-forward.mjs"),
  );
  if (index < 0) return false;
  lines.splice(index, 1);
  writeText(file, `${lines.join("\n").replace(/\n*$/, "")}\n`);
  return true;
}

// Codex 只在「审阅并信任过 hook 的当前哈希」之后才会执行它；未信任的 hook
// 会被静默跳过 —— 实测在 codex exec 下连一行警告都没有。信任状态记在
// config.toml 的 [hooks.state] 里，但哈希是 Codex 内部算法，Loom 无从复算，
// 所以「是否已生效」只能靠有没有真收到事件来判断，不能从配置反推。
const CODEX_TRUST_HINT = "Codex 要求先信任 hook 才会执行，未信任会被静默跳过。在终端运行 codex，输入 /hooks 信任「Loom 活动流」。";

type VerifiedMap = { claude?: number; codex?: number };

function buildStatus(
  port: number,
  token: string,
  verified: VerifiedMap,
  lastEventAt: VerifiedMap,
): ActivityStatus {
  const paths = configPaths();
  const claudeConfigured = isClaudeEnabled(paths.claude);
  const codexConfigured = isCodexEnabled(paths.codex);
  return {
    ok: true,
    port,
    tokenPreview: tokenPreview(token),
    files: allFiles(),
    tools: {
      claude: {
        configured: claudeConfigured,
        verifiedAt: verified.claude,
        lastEventAt: lastEventAt.claude,
        path: paths.claude,
      },
      codex: {
        configured: codexConfigured,
        verifiedAt: verified.codex,
        lastEventAt: lastEventAt.codex,
        path: paths.codex,
        // 已写入但从未收到过事件 —— 最可能的原因就是还没信任。
        actionRequired: codexConfigured && !verified.codex ? CODEX_TRUST_HINT : undefined,
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
  const verified: VerifiedMap = { ...(store.getSettings().activity.verified ?? {}) };
  const lastEventAt: VerifiedMap = {};
  let stopped = false;

  // 收到事件 = 这条链路真的通了。这是「已接入」唯一站得住的凭据：
  // 配置写没写只说明 Loom 的意图，Codex 那边未信任的 hook 是被静默跳过的。
  function markVerified(tool: ActivityTool, ts: number) {
    lastEventAt[tool] = ts;
    if (verified[tool]) return;
    verified[tool] = ts;
    store.patchSettings({ activity: { verified: { ...verified } } });
  }

  function snapshot(): ActivitySession[] {
    return [...sessions.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  function send(event: ActivityEvent) {
    sendToWindow(getWin, "activity:event", event);
  }

  // agent 答完一轮 / 需要输入时响一声——这是用户该回去看一眼的时刻。
  // 复用「工作站桌面通知」开关；macOS 指定系统声音名确保出声。
  function notifyCompletion(event: ActivityEvent) {
    if (event.kind !== "turn_end" && event.kind !== "permission") return;
    if (!store.getSettings().monitor.notify) return;
    if (!Notification.isSupported()) return;
    const label = event.tool === "claude" ? "Claude" : "Codex";
    const where = event.project || event.cwd || event.sessionId;
    try {
      new Notification({
        title: `${label} · ${where}`,
        body: event.kind === "permission" ? "需要你批准" : "回合完成",
        silent: false,
        sound: "Glass",
      }).show();
    } catch {
      // 通知尽力而为，不能影响事件收集。
    }
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
    markVerified(event.tool, event.ts);
    send(event);
    notifyCompletion(event);
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse, tool: ActivityTool) {
    if (!hasValidToken(req, token)) {
      jsonResponse(res, 401);
      return;
    }
    try {
      const body = await readBody(req);
      const event = normalizeHookEvent(tool, body);
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
      // 端口可能被探测改过，forwarder 靠这个文件找到我们 —— 必须在这里落盘，
      // 而不是只在启用时写，否则换端口后已信任的 hook 会指向旧端口。
      writeEndpointFile(port, token);
      console.log(`[collector] listening on 127.0.0.1:${port}`);
    })
    .catch((err) => console.log("[collector] failed to listen:", (err as Error)?.message ?? err));

  ipcMain.handle("activity:list", () => snapshot());
  ipcMain.handle("activity:status", () => buildStatus(port, token, verified, lastEventAt));
  ipcMain.handle("activity:enable", (_e, arg?: ActivityConfigArg): ConfigResult => {
    const tools = normalizeTools(arg?.tools);
    const files = configPaths();
    const changed: string[] = [];
    const notes: ConfigResult["notes"] = [];

    // forwarder 只认这个文件；它得先在，hook 才有意义。
    writeEndpointFile(port, token);

    if (tools.includes("claude") && ensureClaudeEnabled(files.claude, port, token)) changed.push(files.claude);
    if (tools.includes("codex")) {
      if (ensureCodexEnabled(files.codex)) changed.push(files.codex);
      if (removeLegacyLoomNotify(legacyCodexConfig())) changed.push(legacyCodexConfig());
      notes.push({ tool: "codex", path: files.codex, message: CODEX_TRUST_HINT });
    }

    return {
      ok: true,
      port,
      tokenPreview: tokenPreview(token),
      files: tools.map((tool) => files[tool]),
      changed,
      conflicts: [],
      notes,
      status: buildStatus(port, token, verified, lastEventAt),
    };
  });
  ipcMain.handle("activity:disable", (_e, arg?: ActivityConfigArg): ConfigResult => {
    const tools = normalizeTools(arg?.tools);
    const files = configPaths();
    const changed: string[] = [];

    if (tools.includes("claude") && disableClaude(files.claude)) changed.push(files.claude);
    if (tools.includes("codex")) {
      if (disableCodex(files.codex)) changed.push(files.codex);
      if (removeLegacyLoomNotify(legacyCodexConfig())) changed.push(legacyCodexConfig());
    }

    // 断开后「曾经验证过」不再成立 —— 留着会让重新启用时直接显示已接入，
    // 掩盖 Codex 需要重新信任这件事。
    for (const tool of tools) delete verified[tool];
    store.patchSettings({ activity: { verified: { ...verified } } });

    return {
      ok: true,
      port,
      tokenPreview: tokenPreview(token),
      files: tools.map((tool) => files[tool]),
      changed,
      conflicts: [],
      notes: [],
      status: buildStatus(port, token, verified, lastEventAt),
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
