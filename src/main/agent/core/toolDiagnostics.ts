export type ToolErrorKind = "execution" | "command" | "permission" | "timeout" | "cancelled" | "unknown";

export type ToolProcessState = "completed" | "failed" | "failed_to_start" | "blocked" | "timed_out" | "cancelled";

export interface ToolDiagnosticDetails {
  tool?: string;
  kind?: ToolErrorKind;
  processState?: ToolProcessState;
  error?: string;
  argv?: string[];
  cwd?: string;
  exitCode?: number | null;
  signal?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  blocked?: { reason: string };
  truncation?: { truncated: boolean; limit?: number };
  [key: string]: unknown;
}

export const DEFAULT_TOOL_DIAGNOSTIC_LIMIT = 4_000;

export function boundedDiagnosticText(value: unknown, limit = DEFAULT_TOOL_DIAGNOSTIC_LIMIT): string {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : String(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 14))}…[truncated]`;
}

export function normalizeUnexpectedToolError(toolName: string, error: unknown) {
  const message = boundedDiagnosticText(error);
  return {
    message: `Tool ${toolName} failed: ${message}`,
    details: {
      tool: toolName,
      kind: "execution" as const,
      processState: "failed" as const,
      error: message,
    } satisfies ToolDiagnosticDetails,
  };
}
