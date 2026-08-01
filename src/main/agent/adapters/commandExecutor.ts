import { existsSync } from "fs";
import { spawn } from "child_process";
import { isAbsolute } from "path";
import type { CommandExecutionRequest, CommandExecutionResult, CommandPort } from "../ports";

export interface CommandSandboxAdapter {
  available: boolean;
  wrap(request: CommandExecutionRequest): { command: string; args: string[] };
}

function quoteProfilePath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function macSandboxProfile(request: CommandExecutionRequest): string {
  const readableRoots = [...new Set([request.cwd, ...request.workspaceRoots, ...(request.writableRoots ?? [])])]
    .filter(isAbsolute)
    .map((root) => `(allow file-read* (subpath "${quoteProfilePath(root)}"))`)
    .join(" ");
  const writableRoots = request.permission.sandboxMode === "read-only"
    ? []
    : [...new Set([...(request.writableRoots ?? []), ...request.workspaceRoots])]
    .filter(isAbsolute)
    .map((root) => `(allow file-write* (subpath "${quoteProfilePath(root)}"))`)
    .join(" ");
  const network = request.permission.networkAccess ? "(allow network*)" : "(deny network*)";
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read* (subpath \"/usr\"))",
    "(allow file-read* (subpath \"/bin\"))",
    "(allow file-read* (subpath \"/sbin\"))",
    "(allow file-read* (subpath \"/System\"))",
    "(allow file-read* (subpath \"/Library\"))",
    "(allow file-read* (subpath \"/private/tmp\"))",
    readableRoots,
    writableRoots,
    network,
  ].filter(Boolean).join(" ");
}

export function createDefaultCommandSandboxAdapter(platform = process.platform): CommandSandboxAdapter {
  if (platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    return {
      available: true,
      wrap(request) {
        return {
          command: "/usr/bin/sandbox-exec",
          args: ["-p", macSandboxProfile(request), request.argv[0], ...request.argv.slice(1)],
        };
      },
    };
  }
  return {
    available: false,
    wrap(request) {
      return { command: request.argv[0], args: request.argv.slice(1) };
    },
  };
}

function safeEnvironment(overrides: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const allowed = /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|CI|TERM|SHELL|ELECTRON_RUN_AS_NODE)$/;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.test(key) && value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (allowed.test(key)) env[key] = value;
  }
  return env;
}

function blockedResult(request: CommandExecutionRequest, reason: "sandbox_unavailable"): CommandExecutionResult {
  return {
    argv: request.argv,
    cwd: request.cwd,
    stdout: "",
    stderr: `Command blocked: ${reason}`,
    exitCode: null,
    timedOut: false,
    cancelled: false,
    truncated: false,
    blocked: { reason },
  };
}

export function createCommandPort(options: {
  sandbox?: CommandSandboxAdapter;
  platform?: NodeJS.Platform;
} = {}): CommandPort {
  const sandbox = options.sandbox ?? createDefaultCommandSandboxAdapter(options.platform ?? process.platform);

  return {
    execute(request) {
      if (request.argv.length === 0 || !request.argv[0]) throw new Error("Command argv must not be empty.");
      if (!isAbsolute(request.cwd)) throw new Error("Command cwd must be absolute.");
      if (request.permission.sandboxAvailable === false || (request.permission.sandboxMode !== "danger-full-access" && !sandbox.available)) {
        return Promise.resolve(blockedResult(request, "sandbox_unavailable"));
      }

      const wrapped = request.permission.sandboxMode === "danger-full-access"
        ? { command: request.argv[0], args: request.argv.slice(1) }
        : sandbox.wrap(request);
      const maxOutputChars = Math.max(1_024, Math.floor(request.maxOutputChars));
      const timeoutMs = Math.max(100, Math.floor(request.timeoutMs ?? 120_000));

      return new Promise<CommandExecutionResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let truncated = false;
        let timedOut = false;
        let cancelled = false;
        let settled = false;
        const child = spawn(wrapped.command, wrapped.args, {
          cwd: request.cwd,
          env: safeEnvironment(request.env),
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });

        const finish = (result: CommandExecutionResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const kill = () => {
          if (child.killed) return;
          if (process.platform !== "win32") {
            try {
              process.kill(-child.pid!, "SIGTERM");
            } catch {
              // Detached process groups are not available in every host
              // (notably Electron runners); still terminate the direct child.
            }
          }
          child.kill("SIGTERM");
        };
        const append = (kind: "stdout" | "stderr", chunk: Buffer) => {
          const text = chunk.toString("utf8");
          const used = stdout.length + stderr.length;
          const remaining = Math.max(0, maxOutputChars - used);
          const bounded = text.slice(0, remaining);
          if (kind === "stdout") stdout += bounded;
          else stderr += bounded;
          if (bounded.length < text.length) {
            truncated = true;
            kill();
          }
        };
        const onAbort = () => {
          cancelled = true;
          kill();
        };
        const timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, timeoutMs);
        child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
        child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
        child.on("error", (error) => finish({
          argv: request.argv,
          cwd: request.cwd,
          stdout,
          stderr: `${stderr}${error.message}`,
          exitCode: null,
          timedOut,
          cancelled,
          truncated,
        }));
        child.on("close", (exitCode, signal) => finish({
          argv: request.argv,
          cwd: request.cwd,
          stdout,
          stderr,
          exitCode,
          signal: signal ?? undefined,
          timedOut,
          cancelled,
          truncated,
        }));
        if (request.signal?.aborted) onAbort();
        else request.signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}
