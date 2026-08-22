import { describe, expect, it } from "vitest";
import { augmentWindowsRuntimePath, createCommandPort, type CommandSandboxAdapter } from "./commandExecutor";

const unrestricted: CommandSandboxAdapter = {
  available: true,
  wrap: (request) => ({ command: request.argv[0], args: request.argv.slice(1) }),
};

const permission = { sandboxMode: "danger-full-access" as const, approvalPolicy: "never" as const, networkAccess: true };

describe("command executor", () => {
  it("adds common Windows runtime locations without relying on a shell profile", () => {
    const path = augmentWindowsRuntimePath("C:\\Windows\\System32", {
      APPDATA: "C:\\Users\\neo\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\neo\\AppData\\Local",
      NVM_SYMLINK: "C:\\nvm\\nodejs",
      PNPM_HOME: "C:\\Users\\neo\\AppData\\Local\\pnpm",
      USERPROFILE: "C:\\Users\\neo",
    });

    expect(path?.split(";")).toEqual(expect.arrayContaining([
      "C:\\Windows\\System32",
      "C:\\Users\\neo\\AppData\\Roaming\\npm",
      "C:\\Users\\neo\\AppData\\Roaming\\pnpm",
      "C:\\Users\\neo\\AppData\\Local\\pnpm",
      "C:\\nvm\\nodejs",
      "C:\\Users\\neo\\.bun\\bin",
      "C:\\Users\\neo\\.fnm",
    ]));
  });

  it("augments an existing Windows Electron PATH before spawning a command", async () => {
    const result = await createCommandPort({
      platform: "win32",
      sandbox: unrestricted,
      resolveRuntimePath: async () => { throw new Error("Windows PATH must not depend on a shell"); },
    }).execute({
      argv: [process.execPath, "-e", "process.stdout.write(process.env.PATH ?? '')"],
      cwd: process.cwd(),
      env: { PATH: "C:\\Windows\\System32", APPDATA: "C:\\Users\\neo\\AppData\\Roaming", USERPROFILE: "C:\\Users\\neo" },
      maxOutputChars: 4096,
      permission,
      workspaceRoots: [process.cwd()],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("C:\\Users\\neo\\AppData\\Roaming\\npm");
  });

  it("uses the caller's login-shell PATH when the Electron process PATH is incomplete", async () => {
    const result = await createCommandPort({
      sandbox: unrestricted,
      resolveRuntimePath: async () => "/custom/runtime/bin:/usr/bin",
    }).execute({
      argv: [process.execPath, "-e", "process.stdout.write(process.env.PATH ?? '')"],
      cwd: process.cwd(),
      maxOutputChars: 1024,
      permission,
      workspaceRoots: [process.cwd()],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/custom/runtime/bin");
  });

  it("executes argv without a shell and bounds output", async () => {
    const result = await createCommandPort({ sandbox: unrestricted }).execute({
      argv: [process.execPath, "-e", "process.stdout.write('a'.repeat(5000))"],
      cwd: process.cwd(),
      maxOutputChars: 1024,
      permission,
      workspaceRoots: [process.cwd()],
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
    expect(result.truncated).toBe(true);
  });

  it("cancels a running process", async () => {
    const controller = new AbortController();
    const promise = createCommandPort({ sandbox: unrestricted }).execute({
      argv: [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      maxOutputChars: 1024,
      permission,
      workspaceRoots: [process.cwd()],
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(result.cancelled).toBe(true);
  });

  it("fails closed when a restricted sandbox adapter is unavailable", async () => {
    const result = await createCommandPort({ sandbox: { available: false, wrap: unrestricted.wrap } }).execute({
      argv: [process.execPath, "-e", "process.exit(0)"],
      cwd: process.cwd(),
      maxOutputChars: 1024,
      permission: { sandboxMode: "workspace-write", approvalPolicy: "on-request", networkAccess: false },
      workspaceRoots: [process.cwd()],
    });
    expect(result.blocked).toEqual({ reason: "sandbox_unavailable" });
  });
});
