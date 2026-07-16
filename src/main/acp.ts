import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createReadStream, promises as fs } from "fs";
import { basename, isAbsolute, relative, resolve } from "path";
import { Readable, Writable } from "stream";
import { BrowserWindow, dialog, ipcMain } from "electron";
// @agentclientprotocol/sdk 是 ESM-only；electron 主进程打成 CJS，静态 import 会触发
// ERR_REQUIRE_ESM。故值（ClientSideConnection/ndJsonStream/PROTOCOL_VERSION）走
// acp:start 里的动态 import()（CJS 可动态加载 ESM），类型走 import type（编译期擦除）。
import type {
  ClientSideConnection,
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";
import type { Store } from "./store/store";

export type AcpSessionStatus = "starting" | "ready" | "thinking" | "error" | "stopped";

export type AcpSessionDto = {
  id: string;
  cwd: string;
  project: string;
  status: AcpSessionStatus;
  error?: string;
};

type PendingPermission = {
  requestId: string;
  resolve: (response: RequestPermissionResponse) => void;
  timer: NodeJS.Timeout;
};

type AcpSession = {
  id: string;
  cwd: string;
  project: string;
  status: AcpSessionStatus;
  child: ChildProcessWithoutNullStreams;
  conn: ClientSideConnection;
  pending: Map<string, PendingPermission>;
  stderr: string[];
  error?: string;
};

type AcpEvent =
  | { type: "started"; sessionId: string; session: AcpSessionDto }
  | { type: "update"; sessionId: string; update: SessionUpdate }
  | { type: "permission"; sessionId: string; requestId: string; title: string; options: { id: string; label: string; kind?: string }[] }
  | { type: "error"; sessionId?: string; message: string; hint?: string }
  | { type: "stopped"; sessionId: string; session: AcpSessionDto };

const PERMISSION_TIMEOUT_MS = 5 * 60_000;

function npxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function dto(session: AcpSession): AcpSessionDto {
  return {
    id: session.id,
    cwd: session.cwd,
    project: session.project,
    status: session.status,
    error: session.error,
  };
}

function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

function hintFor(error: unknown, stderr = ""): string {
  const text = `${String((error as Error)?.message ?? error)}\n${stderr}`.toLowerCase();
  if (text.includes("unsupported model") || text.includes("model not") || (text.includes("400") && text.includes("model"))) {
    return "该模型不被当前 Claude 端点支持。请在 Loom 设置里把「模型」改为你端点支持的名称（与聊天用的一致），再重新启动会话。";
  }
  if (text.includes("auth") || text.includes("login") || text.includes("unauthorized")) {
    return "请先在终端完成 Claude Code 登录，然后回到 Loom 重新启动会话。";
  }
  if (text.includes("enotfound") || text.includes("network") || text.includes("eai_again") || text.includes("npm")) {
    return "首次启动需要通过 npx 拉取 @zed-industries/claude-code-acp；请检查网络后重试。";
  }
  if (text.includes("enoent")) {
    return "未找到 npx。请确认 Node.js/npm 可用后重试。";
  }
  return "请确认本机 Claude Code 已登录、网络可用，并在终端可运行 claude。";
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function readTextFileWithinCwd(cwd: string, path: string, line?: number | null, limit?: number | null) {
  const file = resolve(path);
  if (!isInside(cwd, file)) throw new Error("Refusing to read outside the ACP session directory.");
  if (!line && !limit) return fs.readFile(file, "utf8");

  const start = Math.max(1, line ?? 1);
  const max = Math.max(1, Math.min(limit ?? 200, 1_000));
  const lines: string[] = [];
  let current = 0;
  const stream = createReadStream(file, { encoding: "utf8" });
  let carry = "";
  for await (const chunk of stream) {
    carry += chunk;
    let index = carry.indexOf("\n");
    while (index >= 0) {
      current += 1;
      const next = carry.slice(0, index);
      carry = carry.slice(index + 1);
      if (current >= start) lines.push(next);
      if (lines.length >= max) {
        stream.destroy();
        return lines.join("\n");
      }
      index = carry.indexOf("\n");
    }
  }
  if (carry) {
    current += 1;
    if (current >= start && lines.length < max) lines.push(carry);
  }
  return lines.join("\n");
}

export function registerAcp(opts: { getWin: () => BrowserWindow | null; store: Store }) {
  const { getWin } = opts;
  const sessions = new Map<string, AcpSession>();

  function send(event: AcpEvent) {
    getWin()?.webContents.send("acp:event", event);
  }

  function finishPermission(session: AcpSession, requestId: string, response: RequestPermissionResponse) {
    const pending = session.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    session.pending.delete(requestId);
    pending.resolve(response);
    return true;
  }

  function rejectAllPending(session: AcpSession) {
    for (const requestId of [...session.pending.keys()]) finishPermission(session, requestId, cancelledPermission());
  }

  function statusFromTool(status?: ToolCallStatus | null): "pending" | "in_progress" | "done" | "error" {
    if (status === "completed") return "done";
    if (status === "failed") return "error";
    if (status === "in_progress") return "in_progress";
    return "pending";
  }

  function updateSessionFromNotification(session: AcpSession, params: SessionNotification) {
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
      session.status = "thinking";
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const status = statusFromTool(update.status);
      if (status === "done" || status === "error") session.status = "ready";
      else session.status = "thinking";
    }
    send({ type: "update", sessionId: params.sessionId, update });
  }

  function permissionTitle(params: RequestPermissionRequest): string {
    return params.toolCall.title || params.toolCall.kind || "需要权限";
  }

  function makeClient(sessionIdRef: { id?: string; localId: string }): Client {
    return {
      requestPermission: async (params) => {
        const sessionId = sessionIdRef.id ?? params.sessionId ?? sessionIdRef.localId;
        const session = sessions.get(sessionId) ?? sessions.get(sessionIdRef.localId);
        if (!session) return cancelledPermission();
        const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        const promise = new Promise<RequestPermissionResponse>((resolvePermission) => {
          const timer = setTimeout(() => {
            finishPermission(session, requestId, cancelledPermission());
          }, PERMISSION_TIMEOUT_MS);
          session.pending.set(requestId, { requestId, resolve: resolvePermission, timer });
        });
        send({
          type: "permission",
          sessionId: session.id,
          requestId,
          title: permissionTitle(params),
          options: params.options.map((option) => ({
            id: option.optionId,
            label: option.name,
            kind: option.kind,
          })),
        });
        return promise;
      },
      sessionUpdate: async (params) => {
        const session = sessions.get(params.sessionId) ?? sessions.get(sessionIdRef.localId);
        if (!session) return;
        if (!sessionIdRef.id) sessionIdRef.id = params.sessionId;
        updateSessionFromNotification(session, params);
      },
      readTextFile: async (params) => {
        const session = sessions.get(params.sessionId) ?? sessions.get(sessionIdRef.localId);
        if (!session) throw new Error("ACP session is not available.");
        return { content: await readTextFileWithinCwd(session.cwd, params.path, params.line, params.limit) };
      },
      writeTextFile: async (params) => {
        const session = sessions.get(params.sessionId) ?? sessions.get(sessionIdRef.localId);
        if (!session) throw new Error("ACP session is not available.");
        const file = resolve(params.path);
        if (!isInside(session.cwd, file)) throw new Error("Refusing to write outside the ACP session directory.");
        await fs.writeFile(file, params.content, "utf8");
        return {};
      },
      createTerminal: async () => {
        throw new Error("Terminal execution is not supported by Loom ACP MVP.");
      },
    };
  }

  async function stopSession(session: AcpSession) {
    rejectAllPending(session);
    if (session.status !== "stopped") {
      try {
        await session.conn.cancel({ sessionId: session.id });
      } catch {
        // Best effort; stopping must still kill the adapter.
      }
      try {
        await session.conn.closeSession({ sessionId: session.id });
      } catch {
        // Some adapters may not implement close; child.kill below is authoritative.
      }
    }
    session.status = "stopped";
    try {
      session.child.kill();
    } catch {
      // Best effort.
    }
    send({ type: "stopped", sessionId: session.id, session: dto(session) });
  }

  ipcMain.handle("acp:start", async (_e, arg: { cwd?: string; model?: string }) => {
    const cwd = resolve(String(arg?.cwd ?? ""));
    // adapter 底层 claude-agent-sdk 默认模型可能不被用户端点（代理）支持 → 注入
    // ANTHROPIC_MODEL 覆盖：优先显式传参 > 环境已设 > Loom 设置里的模型。
    const settingsModel = opts.store.getSettings().access.model?.trim();
    const acpModel = String(arg?.model ?? "").trim() || process.env.ANTHROPIC_MODEL || settingsModel || "";
    const localId = `acp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const sessionIdRef: { id?: string; localId: string } = { localId };
    let child: ChildProcessWithoutNullStreams | undefined;
    const stderr: string[] = [];
    try {
      const stat = await fs.stat(cwd);
      if (!stat.isDirectory()) throw new Error("请选择一个项目目录。");

      // ESM-only SDK：CJS 主进程用动态 import() 加载。
      const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } = await import("@agentclientprotocol/sdk");

      child = spawn(npxCommand(), ["-y", "@zed-industries/claude-code-acp"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(acpModel ? { ANTHROPIC_MODEL: acpModel } : {}) },
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr.push(String(chunk));
        if (stderr.join("").length > 12_000) stderr.splice(0, stderr.length - 12);
      });
      child.on("error", (error) => {
        stderr.push(String((error as Error)?.message ?? error));
      });

      const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
      const conn = new ClientSideConnection(() => makeClient(sessionIdRef), stream);
      const provisional: AcpSession = {
        id: localId,
        cwd,
        project: basename(cwd),
        status: "starting",
        child,
        conn,
        pending: new Map(),
        stderr,
      };
      sessions.set(localId, provisional);

      await conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });

      const created = await conn.newSession({ cwd, mcpServers: [] });
      sessions.delete(localId);
      provisional.id = created.sessionId;
      provisional.status = "ready";
      sessionIdRef.id = created.sessionId;
      sessions.set(created.sessionId, provisional);
      send({ type: "started", sessionId: created.sessionId, session: dto(provisional) });
      return { ok: true, sessionId: created.sessionId };
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      const hint = hintFor(error, stderr.join(""));
      if (child) child.kill();
      sessions.delete(localId);
      send({ type: "error", message, hint });
      return { ok: false, message, hint };
    }
  });

  ipcMain.handle("acp:prompt", async (_e, arg: { sessionId: string; text: string }) => {
    const session = sessions.get(arg.sessionId);
    const text = String(arg.text ?? "").trim();
    if (!session || !text) return { ok: false };
    try {
      session.status = "thinking";
      send({
        type: "update",
        sessionId: session.id,
        update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
      });
      await session.conn.prompt({
        sessionId: session.id,
        prompt: [{ type: "text", text }],
      });
      session.status = "ready";
      return { ok: true };
    } catch (error) {
      session.status = "error";
      session.error = String((error as Error)?.message ?? error);
      send({ type: "error", sessionId: session.id, message: session.error, hint: hintFor(error, session.stderr.join("")) });
      return { ok: false, message: session.error };
    }
  });

  ipcMain.handle("acp:cancel", async (_e, arg: { sessionId: string }) => {
    const session = sessions.get(arg.sessionId);
    if (!session) return { ok: false };
    rejectAllPending(session);
    try {
      await session.conn.cancel({ sessionId: session.id });
      session.status = "ready";
      return { ok: true };
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      send({ type: "error", sessionId: session.id, message, hint: hintFor(error, session.stderr.join("")) });
      return { ok: false, message };
    }
  });

  ipcMain.handle("acp:respondPermission", (_e, arg: { sessionId: string; requestId: string; optionId?: string }) => {
    const session = sessions.get(arg.sessionId);
    if (!session) return { ok: false };
    const response: RequestPermissionResponse = arg.optionId
      ? { outcome: { outcome: "selected", optionId: arg.optionId } }
      : cancelledPermission();
    return { ok: finishPermission(session, arg.requestId, response) };
  });

  ipcMain.handle("acp:stop", async (_e, arg: { sessionId: string }) => {
    const session = sessions.get(arg.sessionId);
    if (!session) return { ok: false };
    await stopSession(session);
    sessions.delete(session.id);
    return { ok: true };
  });

  ipcMain.handle("acp:pickDir", async () => {
    const win = getWin();
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, path: result.filePaths[0] };
  });

  ipcMain.handle("acp:list", () => [...sessions.values()].map(dto));

  function stop() {
    for (const session of sessions.values()) {
      void stopSession(session);
    }
    sessions.clear();
    ipcMain.removeHandler("acp:start");
    ipcMain.removeHandler("acp:prompt");
    ipcMain.removeHandler("acp:cancel");
    ipcMain.removeHandler("acp:respondPermission");
    ipcMain.removeHandler("acp:stop");
    ipcMain.removeHandler("acp:pickDir");
    ipcMain.removeHandler("acp:list");
  }

  return { stop };
}
