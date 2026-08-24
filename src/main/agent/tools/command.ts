import { basename, isAbsolute, relative, resolve, sep } from "path";
import { Type } from "typebox";
import type { CommandPort } from "../ports";
import type { PermissionContext } from "../core/permissions";
import type { AgentTool, ToolProcessState } from "../core/tool";
import { boundedDiagnosticText } from "../core/toolDiagnostics";
import { limitText, textResult } from "../core/tool";

const COMMAND_DIAGNOSTIC_LIMIT = 4_000;
const COMMAND_DETAIL_OUTPUT_LIMIT = 16_000;

interface CommandArgs {
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  outputs?: CommandOutput[];
}

interface CommandOutput {
  path: string;
  operation?: "created" | "updated" | "exported";
}

function declaredArtifacts(outputs: CommandOutput[] | undefined, cwd: string, succeeded: boolean) {
  if (!succeeded || !outputs || outputs.length === 0) return undefined;
  return outputs.map((output) => {
    if (output.path.trim().length === 0 || output.path.includes("\0")) {
      throw new Error("Generated file output paths must be non-empty and cannot contain null bytes.");
    }
    return {
      absolutePath: isAbsolute(output.path) ? resolve(output.path) : resolve(cwd, output.path),
      operation: output.operation ?? "created",
    };
  });
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

function commandProcessState(result: {
  processState?: ToolProcessState;
  blocked?: unknown;
  cancelled: boolean;
  timedOut: boolean;
  exitCode: number | null;
}): ToolProcessState {
  if (result.blocked) return "blocked";
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timed_out";
  if (result.processState) return result.processState;
  if (result.exitCode === 0) return "completed";
  return result.exitCode === null ? "failed_to_start" : "failed";
}

function commandDiagnostic(input: {
  argv: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  processState: ToolProcessState;
  timedOut: boolean;
  cancelled: boolean;
  blocked?: { reason: string };
  noMatch: boolean;
}): string {
  const status = input.noMatch
    ? "No matches found"
    : input.blocked
      ? `Command blocked (${input.blocked.reason})`
      : input.processState === "timed_out"
        ? "Command timed out"
        : input.processState === "cancelled"
          ? "Command cancelled"
          : input.exitCode === 0
            ? "Command completed"
            : input.exitCode === null
              ? "Command failed to start"
              : `Command failed with exit code ${input.exitCode}`;
  const lines = [status, `cwd: ${input.cwd}`, `argv: ${input.argv.join(" ")}`];
  if (input.timedOut) lines.push("timeout: true");
  if (input.cancelled) lines.push("cancelled: true");
  if (input.stdout) lines.push(`stdout:\n${boundedDiagnosticText(input.stdout, 1_200)}`);
  if (input.stderr) lines.push(`stderr:\n${boundedDiagnosticText(input.stderr, 1_200)}`);
  return boundedDiagnosticText(lines.join("\n"), COMMAND_DIAGNOSTIC_LIMIT);
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
    description: "Run an argv-structured local command inside the current Project execution boundary. Declare generated files in outputs so they can be opened from the message.",
    parameters: Type.Object({
      argv: Type.Array(Type.String(), { description: "Executable and arguments; no shell interpolation." }),
      cwd: Type.Optional(Type.String({ description: "Absolute working directory; defaults to the current Project root." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds." })),
      outputs: Type.Optional(Type.Array(Type.Object({
        path: Type.String({ description: "Generated file path, relative to cwd or absolute." }),
        operation: Type.Optional(Type.Union([
          Type.Literal("created"),
          Type.Literal("updated"),
          Type.Literal("exported"),
        ])),
      }), { description: "Files created, updated, or exported by the command." })),
    }),
    readOnly: false,
    permission: {
      request: (args) => {
        const cwd = args.cwd ? resolve(args.cwd) : input.cwd;
        return {
          capability: "command",
          risk: "elevated",
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
      const executable = basename(result.argv[0] ?? "").toLowerCase();
      const noMatch = result.exitCode === 1 && (executable === "grep" || executable === "rg") && !result.blocked && !result.timedOut && !result.cancelled;
      const succeeded = result.exitCode === 0 && !result.blocked && !result.timedOut && !result.cancelled;
      const stdout = limitText(result.stdout, COMMAND_DETAIL_OUTPUT_LIMIT);
      const stderr = limitText(result.stderr, COMMAND_DETAIL_OUTPUT_LIMIT);
      const processState = commandProcessState(result);
      const truncation = {
        truncated: result.truncated || stdout.truncation.truncated || stderr.truncation.truncated,
        limit: context.commandOutputLimit ?? 64_000,
      };
      return textResult(commandDiagnostic({
        argv: result.argv,
        cwd: result.cwd,
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode: result.exitCode,
        processState,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        blocked: result.blocked,
        noMatch,
      }), {
        argv: result.argv,
        cwd: result.cwd,
        exitCode: result.exitCode,
        noMatch,
        processState,
        signal: result.signal,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        stdout: stdout.text,
        stderr: stderr.text,
        truncation,
        blocked: result.blocked,
        artifacts: declaredArtifacts(args.outputs, result.cwd, succeeded),
      }, !succeeded && !noMatch);
    },
  };
}
