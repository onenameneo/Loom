import { basename, isAbsolute, relative, resolve, sep } from "path";
import { Type } from "typebox";
import type { CommandPort } from "../ports";
import type { PermissionContext } from "../core/permissions";
import type { AgentTool } from "../core/tool";
import { textResult } from "../core/tool";

interface CommandArgs {
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
}

function inside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function commandTarget(argv: string[]): string {
  return `command:${argv[0] ?? ""}`;
}

function isTrustedCommand(argv: string[]): boolean {
  const executable = basename(argv[0] ?? "").toLowerCase();
  return new Set(["bash", "cat", "echo", "find", "git", "ls", "node", "npm", "pnpm", "python", "python3", "rg", "sed", "sh", "vitest", "zsh"]).has(executable);
}

export function createCommandTool(input: {
  command: CommandPort;
  cwd: string;
  workspaceRoots: string[];
  writableRoots?: string[];
  getPermissionContext: () => PermissionContext & { commandOutputLimit?: number };
}): AgentTool<CommandArgs, unknown> {
  return {
    name: "run_command",
    label: "Run Command",
    description: "Run an argv-structured local command inside the current Project execution boundary.",
    parameters: Type.Object({
      argv: Type.Array(Type.String(), { description: "Executable and arguments; no shell interpolation." }),
      cwd: Type.Optional(Type.String({ description: "Absolute working directory; defaults to the current Project root." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds." })),
    }),
    readOnly: false,
    permission: {
      request: (args) => {
        const cwd = args.cwd ? resolve(args.cwd) : input.cwd;
        return {
          capability: "command",
          target: args.argv.join(" ").slice(0, 400),
          normalizedTarget: commandTarget(args.argv),
          trusted: isTrustedCommand(args.argv),
          targetInWorkspace: input.workspaceRoots.some((root) => inside(root, cwd)),
          workspaceRoots: input.workspaceRoots,
        };
      },
      preview: (args) => ({
        title: `Run ${args.argv[0] ?? "command"}`,
        description: "The command runs in the main process execution boundary.",
        args: {
          argv: args.argv.slice(0, 12),
          cwd: args.cwd ?? input.cwd,
          argumentCount: args.argv.length,
        },
      }),
    },
    execute: async ({ args, signal }) => {
      const context = input.getPermissionContext();
      const cwd = args.cwd ? resolve(args.cwd) : input.cwd;
      const result = await input.command.execute({
        argv: args.argv,
        cwd,
        timeoutMs: args.timeoutMs,
        maxOutputChars: context.commandOutputLimit ?? 64_000,
        signal,
        permission: context,
        workspaceRoots: input.workspaceRoots,
        writableRoots: input.writableRoots,
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "");
      return textResult(output, {
        argv: result.argv,
        cwd: result.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        truncation: { truncated: result.truncated },
        blocked: result.blocked,
      }, Boolean(result.blocked) || (result.exitCode !== null && result.exitCode !== 0));
    },
  };
}
