import { existsSync, realpathSync } from "fs";
import { execFile, spawn } from "child_process";
import { delimiter, dirname, isAbsolute, join, sep, win32 } from "path";
import type { CommandExecutionRequest, CommandExecutionResult, CommandPort } from "../ports";

export interface CommandSandboxAdapter {
  available: boolean;
  wrap(request: CommandExecutionRequest): { command: string; args: string[] };
}

function quoteProfilePath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function augmentWindowsRuntimePath(pathValue: string | undefined, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathEntries = pathValue?.split(win32.delimiter).filter(Boolean) ?? [];
  const candidates = [
    environment.PNPM_HOME,
    environment.APPDATA && win32.join(environment.APPDATA, "npm"),
    environment.APPDATA && win32.join(environment.APPDATA, "pnpm"),
    environment.LOCALAPPDATA && win32.join(environment.LOCALAPPDATA, "pnpm"),
    environment.USERPROFILE && win32.join(environment.USERPROFILE, ".bun", "bin"),
    environment.FNM_DIR,
    environment.USERPROFILE && win32.join(environment.USERPROFILE, ".fnm"),
    environment.LOCALAPPDATA && win32.join(environment.LOCALAPPDATA, "fnm"),
    environment.VOLTA_HOME && win32.join(environment.VOLTA_HOME, "bin"),
    environment.NVM_HOME,
    environment.NVM_SYMLINK,
    environment.ProgramFiles && win32.join(environment.ProgramFiles, "nodejs"),
    environment.ChocolateyInstall && win32.join(environment.ChocolateyInstall, "bin"),
    environment.USERPROFILE && win32.join(environment.USERPROFILE, "scoop", "shims"),
  ].filter((value): value is string => Boolean(value));
  const entries = [...new Set([...pathEntries, ...candidates])];
  return entries.length > 0 ? entries.join(win32.delimiter) : undefined;
}

function commandRuntimeRoots(request: CommandExecutionRequest): string[] {
  const pathEntries = (request.env?.PATH ?? "").split(delimiter).filter(isAbsolute);
  const candidates = isAbsolute(request.argv[0] ?? "")
    ? [request.argv[0]!]
    : pathEntries.map((entry) => join(entry, request.argv[0]!));
  const roots = new Set(pathEntries);
  const home = process.env.HOME ? `${process.env.HOME}${sep}` : undefined;
  for (const candidate of candidates) {
    try {
      const realExecutable = realpathSync(candidate);
      roots.add(dirname(realExecutable));
      if (home && realExecutable.startsWith(home)) {
        let current = dirname(realExecutable);
        for (let depth = 0; current !== process.env.HOME && depth < 6; depth += 1) {
          roots.add(current);
          current = dirname(current);
        }
      } else if (realExecutable.startsWith("/opt/homebrew/") || realExecutable.startsWith("/usr/local/")) {
        roots.add(realExecutable.startsWith("/opt/homebrew/") ? "/opt/homebrew" : "/usr/local");
      }
    } catch {
      // Let spawn report the actual command error if the executable is absent.
    }
  }
  return [...roots];
}

function macSandboxProfile(request: CommandExecutionRequest): string {
  const readableRoots = [...new Set([request.cwd, ...request.workspaceRoots, ...(request.writableRoots ?? []), ...commandRuntimeRoots(request)])]
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

function safeEnvironment(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const allowed = /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|CI|TERM|SHELL|ELECTRON_RUN_AS_NODE|NVM_DIR|NVM_HOME|NVM_SYMLINK|FNM_DIR|PNPM_HOME|VOLTA_HOME|ASDF_DIR|ASDF_DATA_DIR|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|ProgramFiles|ProgramFiles\(x86\)|SystemRoot|ComSpec|PATHEXT|ChocolateyInstall)$/i;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.test(key) && value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (allowed.test(key)) env[key] = value;
  }
  return env;
}

export async function discoverRuntimePath(platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  if (platform === "win32") return augmentWindowsRuntimePath(process.env.PATH ?? process.env.Path);
  const shell = process.env.SHELL || (platform === "darwin" ? "/bin/zsh" : undefined);
  if (!shell || !isAbsolute(shell) || !existsSync(shell)) return undefined;
  const marker = "__LOOM_PATH__";
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", `printf '\\n${marker}%s\\n' \"$PATH\"`], {
      env: safeEnvironment(),
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const path = String(stdout).match(new RegExp(`${marker}([^\\r\\n]*)`))?.[1]?.trim();
      resolve(path || undefined);
    });
  });
}

async function resolveCommandEnvironment(
  request: CommandExecutionRequest,
  resolveRuntimePath: () => Promise<string | undefined>,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  const env = safeEnvironment(request.env);
  if (platform === "win32") {
    const pathValue = request.env?.PATH ?? request.env?.Path ?? env.PATH ?? env.Path;
    const augmented = augmentWindowsRuntimePath(pathValue, env);
    return augmented ? { ...env, PATH: augmented, Path: augmented } : env;
  }
  if (request.env?.PATH || request.env?.Path) return env;
  const runtimePath = await resolveRuntimePath();
  return runtimePath ? { ...env, PATH: runtimePath } : env;
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
  resolveRuntimePath?: () => Promise<string | undefined>;
} = {}): CommandPort {
  const platform = options.platform ?? process.platform;
  const sandbox = options.sandbox ?? createDefaultCommandSandboxAdapter(platform);
  let runtimePathPromise: Promise<string | undefined> | undefined;
  const resolveRuntimePath = options.resolveRuntimePath ?? (() => {
    runtimePathPromise ??= discoverRuntimePath(platform);
    return runtimePathPromise;
  });

  return {
    async execute(request) {
      if (request.argv.length === 0 || !request.argv[0]) throw new Error("Command argv must not be empty.");
      if (!isAbsolute(request.cwd)) throw new Error("Command cwd must be absolute.");
      if (request.permission.sandboxAvailable === false || (request.permission.sandboxMode !== "danger-full-access" && !sandbox.available)) {
        return blockedResult(request, "sandbox_unavailable");
      }

      const env = await resolveCommandEnvironment(request, resolveRuntimePath, platform);
      const executionRequest = { ...request, env };
      const wrapped = request.permission.sandboxMode === "danger-full-access"
        ? { command: executionRequest.argv[0], args: executionRequest.argv.slice(1) }
        : sandbox.wrap(executionRequest);
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
          cwd: executionRequest.cwd,
          env,
          detached: platform !== "win32",
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
          if (platform !== "win32") {
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
