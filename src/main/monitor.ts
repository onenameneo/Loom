import { execFile } from "child_process";
import { basename } from "path";
import { promisify } from "util";
import { BrowserWindow, Notification, ipcMain } from "electron";
import { sendToWindow } from "./ipcSafeSend";
import type { Store } from "./store/store";

const execFileAsync = promisify(execFile);
const POLL_MS = 4_000;
const IDLE_CPU_THRESHOLD = 1.0;

export type AgentTool = "codex" | "claude";
export type AgentStatus = "running" | "idle";

export interface AgentProc {
  pid: number;
  tool: AgentTool;
  cwd?: string;
  project?: string;
  startedAt: number;
  cpu: number;
  status: AgentStatus;
}

export type MonitorEvent = {
  type: "snapshot" | "started" | "stopped";
  agents: AgentProc[];
  agent?: AgentProc;
};

type PsRow = {
  pid: number;
  command: string;
  startedAt: number;
  cpu: number;
};

type Candidate = PsRow & { tool: AgentTool };
type CpuHistory = { idleStreak: number };

const EXCLUDE_PATTERNS = [
  /app-server/i,
  /\bmcp\b/i,
  /computer-use/i,
  /--analytics/i,
  /extension-host/i,
  /ELECTRON_RUN_AS_NODE/i,
  /\.app\//i, // GUI 应用包内的进程（如 ChatGPT.app 的 Codex Framework 辅助进程）
  /--type=/, // Electron/Chromium 辅助子进程（renderer/gpu/utility）
  /crashpad/i,
];

function log(message: string, command: string) {
  console.debug(`[monitor] ${message}: ${command}`);
}

// ps 的 etime = 已运行时长 `[[dd-]hh:]mm:ss`（纯数字，无 locale 依赖）→ 毫秒。
function etimeToMs(etime: string): number {
  const daySplit = etime.split("-");
  const days = daySplit.length > 1 ? Number(daySplit[0]) : 0;
  const parts = daySplit[daySplit.length - 1].split(":").map((n) => Number(n) || 0);
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else [s] = parts;
  return (((days * 24 + h) * 60 + m) * 60 + s) * 1000;
}

// 列：pid pcpu etime command。用 etime（单 token 时长）而非 lstart（多词本地化日期，
// 在非英文 locale 下会让正则失配 → 全部解析失败）。
function parsePsLine(line: string, scannedAt: number): PsRow | null {
  const match = line.match(/^\s*(\d+)\s+([\d.,]+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const cpu = Number.parseFloat(match[2].replace(",", "."));
  const command = match[4]?.trim();
  if (!Number.isFinite(pid) || !command) return null;
  return {
    pid,
    command,
    startedAt: scannedAt - etimeToMs(match[3]),
    cpu: Number.isFinite(cpu) ? cpu : 0,
  };
}

function commandParts(command: string): string[] {
  return command
    .split(/\s+/)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function toolFromCommand(command: string): AgentTool | null {
  for (const part of commandParts(command)) {
    const name = basename(part).toLowerCase();
    if (name === "codex" || name === "codex-cli") return "codex";
    if (name === "claude" || name === "claude-code") return "claude";
  }
  return null;
}

function isOwnProcess(row: PsRow): boolean {
  if (row.pid === process.pid || row.pid === process.ppid) return true;
  const selfPath = process.execPath.toLowerCase();
  const command = row.command.toLowerCase();
  return Boolean(selfPath && command.includes(selfPath));
}

function isAgentProcess(row: PsRow): Candidate | null {
  const tool = toolFromCommand(row.command);
  if (!tool) return null;
  if (isOwnProcess(row)) {
    log("filtered self process", row.command);
    return null;
  }
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(row.command))) {
    log("filtered background process", row.command);
    return null;
  }
  log("accepted candidate", row.command);
  return { ...row, tool };
}

async function cwdForPid(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const cwdLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("n"));
    return cwdLine?.slice(1) || undefined;
  } catch {
    return undefined;
  }
}

export async function scan(): Promise<AgentProc[]> {
  if (process.platform !== "darwin") return [];

  const scannedAt = Date.now();
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ps", ["-axo", "pid=,pcpu=,etime=,command="], {
      maxBuffer: 16 * 1024 * 1024, // 防御：进程多/命令行长时不超默认 1MB 而 reject
    }));
  } catch (err) {
    console.log("[monitor] ps failed:", (err as Error)?.message ?? err);
    return [];
  }

  const candidates = stdout
    .split("\n")
    .map((line) => parsePsLine(line, scannedAt))
    .filter((row): row is PsRow => Boolean(row))
    .map(isAgentProcess)
    .filter((row): row is Candidate => Boolean(row));

  const agents = await Promise.all(
    candidates.map(async (candidate) => {
      const cwd = await cwdForPid(candidate.pid);
      return {
        pid: candidate.pid,
        tool: candidate.tool,
        cwd,
        project: cwd ? basename(cwd) : undefined,
        startedAt: candidate.startedAt,
        cpu: candidate.cpu,
        status: "running" as const,
      };
    }),
  );

  return agents.sort((a, b) => a.pid - b.pid);
}

function withStatuses(agents: AgentProc[], history: Map<number, CpuHistory>): AgentProc[] {
  return agents.map((agent) => {
    const prev = history.get(agent.pid);
    const idleStreak = agent.cpu < IDLE_CPU_THRESHOLD ? (prev?.idleStreak ?? 0) + 1 : 0;
    history.set(agent.pid, { idleStreak });
    return { ...agent, status: idleStreak >= 2 ? "idle" : "running" };
  });
}

function notifyTitle(type: "started" | "stopped", agent: AgentProc): string {
  const project = agent.project || agent.cwd || `pid ${agent.pid}`;
  return `${type === "started" ? "▶" : "✔"} ${agent.tool} · ${project}`;
}

export function registerMonitor(opts: { getWin: () => BrowserWindow | null; store: Store }) {
  const { getWin, store } = opts;
  let agents: AgentProc[] = [];
  let previous = new Map<number, AgentProc>();
  const cpuHistory = new Map<number, CpuHistory>();
  const startedNotified = new Set<number>();
  const stoppedNotified = new Set<number>();
  let hasScanned = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  function send(type: MonitorEvent["type"], nextAgents: AgentProc[], agent?: AgentProc) {
    sendToWindow(getWin, "monitor:event", { type, agents: nextAgents, agent } satisfies MonitorEvent);
  }

  function notify(type: "started" | "stopped", agent: AgentProc) {
    if (!store.getSettings().monitor.notify) return;
    const notifiedSet = type === "started" ? startedNotified : stoppedNotified;
    if (notifiedSet.has(agent.pid)) return;
    notifiedSet.add(agent.pid);
    try {
      if (Notification.isSupported()) new Notification({ title: notifyTitle(type, agent) }).show();
    } catch {
      // Notifications are best-effort; process monitoring must keep running.
    }
  }

  async function tick() {
    const nextAgents = withStatuses(await scan(), cpuHistory);
    if (stopped) return;
    console.log(
      `[monitor] scan → ${nextAgents.length} agent(s):`,
      nextAgents.map((a) => `${a.tool}#${a.pid}${a.project ? `(${a.project})` : ""}`).join(", ") || "(none)",
    );
    const next = new Map(nextAgents.map((agent) => [agent.pid, agent]));
    const startedAgents = nextAgents.filter((agent) => !previous.has(agent.pid));
    const stoppedAgents = [...previous.values()].filter((agent) => !next.has(agent.pid));

    agents = nextAgents;
    send("snapshot", agents);
    if (hasScanned) {
      for (const agent of startedAgents) {
        send("started", agents, agent);
        notify("started", agent);
      }
    }
    for (const agent of stoppedAgents) {
      send("stopped", agents, agent);
      notify("stopped", agent);
      startedNotified.delete(agent.pid);
      stoppedNotified.delete(agent.pid);
      cpuHistory.delete(agent.pid);
    }
    previous = next;
    hasScanned = true;
  }

  ipcMain.handle("monitor:list", () => agents);
  ipcMain.handle("monitor:setNotify", (_e, on: boolean) => {
    store.patchSettings({ monitor: { notify: Boolean(on) } });
    return { ok: true };
  });

  timer = setInterval(() => {
    void tick();
  }, POLL_MS);
  void tick();

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = undefined;
    ipcMain.removeHandler("monitor:list");
    ipcMain.removeHandler("monitor:setNotify");
  }

  return { stop };
}
