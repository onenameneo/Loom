import { describe, expect, it } from "vitest";
import { createCommandTool } from "./command";
import type { CommandPort } from "../ports";

const permission = { sandboxMode: "danger-full-access" as const, approvalPolicy: "never" as const, networkAccess: true };

function commandTool(result: Awaited<ReturnType<CommandPort["execute"]>>) {
  const command: CommandPort = { execute: async () => result };
  return createCommandTool({
    command,
    cwd: "/tmp",
    workspaceRoots: ["/tmp"],
    getPermissionContext: () => permission,
  });
}

describe("run_command", () => {
  it("treats grep and rg exit code 1 as a successful no-match result", async () => {
    for (const executable of ["grep", "rg"]) {
      const tool = commandTool({
        argv: [executable, "needle", "/tmp/file"],
        cwd: "/tmp",
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        cancelled: false,
        truncated: false,
        processState: "failed",
      });

      const result = await tool.execute({ toolCallId: executable, args: { argv: [executable, "needle", "/tmp/file"] } });
      expect(result.isError).toBe(false);
      expect(result.details).toMatchObject({ exitCode: 1, noMatch: true });
    }
  });

  it("keeps other non-zero command exits as errors", async () => {
    const tool = commandTool({
      argv: ["grep", "needle", "/tmp/missing"],
      cwd: "/tmp",
      stdout: "",
      stderr: "missing file",
      exitCode: 2,
      timedOut: false,
      cancelled: false,
      truncated: false,
      processState: "failed",
    });

    const result = await tool.execute({
      toolCallId: "grep-error",
      args: {
        argv: ["grep", "needle", "/tmp/missing"],
        outputs: [{ path: "missing.txt", operation: "created" }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ exitCode: 2, noMatch: false });
    expect((result.details as { artifacts?: unknown }).artifacts).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("exit code 2") });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("cwd: /tmp") });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("missing file") });
  });

  it("returns declared generated files as artifact details", async () => {
    const tool = commandTool({
      argv: ["node", "build.mjs"],
      cwd: "/tmp/project",
      stdout: "created",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      truncated: false,
      processState: "completed",
    });

    const result = await tool.execute({
      toolCallId: "build",
      args: {
        argv: ["node", "build.mjs"],
        cwd: "/tmp/project",
        outputs: [{ path: "dist/hello-world.pptx", operation: "created" }],
      },
    });

    expect(result.isError).toBe(false);
    expect(result.details).toMatchObject({
      artifacts: [{ absolutePath: "/tmp/project/dist/hello-world.pptx", operation: "created" }],
    });
  });

  it("exposes timeout, cancellation, blocked, and truncation state to the model and observers", async () => {
    const cases = [
      { processState: "timed_out", timedOut: true, cancelled: false, blocked: undefined, exitCode: null, expected: "timed out" },
      { processState: "cancelled", timedOut: false, cancelled: true, blocked: undefined, exitCode: null, expected: "cancelled" },
      { processState: "blocked", timedOut: false, cancelled: false, blocked: { reason: "sandbox_unavailable" as const }, exitCode: null, expected: "sandbox_unavailable" },
    ] as const;

    for (const item of cases) {
      const result = await commandTool({
        argv: ["node", "script.js"],
        cwd: "/tmp",
        stdout: "out",
        stderr: item.blocked ? `Command blocked: ${item.blocked.reason}` : "err",
        exitCode: item.exitCode,
        timedOut: item.timedOut,
        cancelled: item.cancelled,
        truncated: true,
        processState: item.processState,
        blocked: item.blocked,
      }).execute({ toolCallId: item.processState, args: { argv: ["node", "script.js"] } });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(item.expected) });
      expect(result.details).toMatchObject({ processState: item.processState, truncation: { truncated: true } });
    }
  });
});
