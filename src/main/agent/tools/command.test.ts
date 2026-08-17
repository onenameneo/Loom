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
    });

    const result = await tool.execute({ toolCallId: "grep-error", args: { argv: ["grep", "needle", "/tmp/missing"] } });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ exitCode: 2, noMatch: false });
  });
});
