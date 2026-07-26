import type { TSchema } from "typebox";

export type ReadonlyToolExecutionMode = "sequential" | "parallel";

export type ToolTextContent = { type: "text"; text: string };
export type ToolImageContent = { type: "image"; data: string; mimeType: string };
export type ToolContent = ToolTextContent | ToolImageContent;

export interface ToolResult<TDetails = unknown> {
  content: ToolContent[];
  details: TDetails;
  isError?: boolean;
  terminate?: boolean;
}

export interface ToolExecutionContext<TArgs = unknown> {
  toolCallId: string;
  args: TArgs;
  signal?: AbortSignal;
  update?: (result: ToolResult) => void;
}

export type ToolApprovalScope = "once" | "node-session" | "persistent";

export interface ToolApprovalRequirement<TArgs = unknown> {
  required: true;
  defaultScope?: ToolApprovalScope;
  normalizeTarget(args: TArgs): string;
  preview(args: TArgs): {
    title: string;
    description?: string;
    args?: unknown;
  };
}

export interface ReadonlyAgentTool<TArgs = unknown, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  readOnly: true;
  approval?: ToolApprovalRequirement<TArgs>;
  executionMode?: ReadonlyToolExecutionMode;
  execute(ctx: ToolExecutionContext<TArgs>): Promise<ToolResult<TDetails>>;
}

export interface TruncationDetails {
  truncated: boolean;
  originalLength: number;
  limit: number;
}

export function limitText(text: string, limit: number): { text: string; truncation: TruncationDetails } {
  if (limit < 0) throw new Error("limit must be non-negative");
  if (text.length <= limit) {
    return { text, truncation: { truncated: false, originalLength: text.length, limit } };
  }
  return {
    text: text.slice(0, limit),
    truncation: { truncated: true, originalLength: text.length, limit },
  };
}

export function textResult<TDetails>(text: string, details: TDetails, isError = false): ToolResult<TDetails> {
  return { content: [{ type: "text", text }], details, isError };
}

export function resultText(result: Pick<ToolResult, "content">, limit = 800): string {
  const text = result.content
    .map((item) => (item.type === "text" ? item.text : `[image:${item.mimeType}]`))
    .join("\n");
  return limitText(text, limit).text;
}

export function normalizeToolError(toolName: string, err: unknown): ToolResult<{ tool: string; error: string }> {
  const message = err instanceof Error ? err.message : String(err);
  return textResult(`Tool ${toolName} failed: ${message}`, { tool: toolName, error: message }, true);
}
