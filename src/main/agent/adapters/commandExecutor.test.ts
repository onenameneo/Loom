import { describe, expect, it } from "vitest";
import { createCommandPort, type CommandSandboxAdapter } from "./commandExecutor";

const unrestricted: CommandSandboxAdapter = {
  available: true,
  wrap: (request) => ({ command: request.argv[0], args: request.argv.slice(1) }),
};

const permission = { sandboxMode: "danger-full-access" as const, approvalPolicy: "never" as const, networkAccess: true };

describe("command executor", () => {
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
