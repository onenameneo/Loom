import type { TSchema } from "typebox";
import type { AgentTool, ToolExecutionContext } from "../agent/core/tool";
import { redactMcpValue } from "./secrets";
import { adaptMcpToolResult, mcpErrorResult, type McpResultDetails, type McpResultLimits } from "./result";
import type { McpCatalogTool } from "./types";

export interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

function safePreviewArgs(value: unknown): unknown {
  const redacted = redactMcpValue(value);
  try {
    const serialized = JSON.stringify(redacted);
    return serialized.length <= 4_000 ? redacted : `${serialized.slice(0, 4_000)}…`;
  } catch {
    return "[unserializable arguments]";
  }
}

function mcpTarget(tool: McpCatalogTool): string {
  return `mcp://${tool.serverId}/${tool.name}`;
}

export function mcpToolFromCatalog(tool: McpCatalogTool, caller: McpToolCaller, limits?: McpResultLimits): AgentTool<Record<string, unknown>, McpResultDetails> {
  const target = mcpTarget(tool);
  const destructive = tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint !== true;
  return {
    name: tool.namespacedName,
    label: tool.title ?? tool.name,
    description: tool.description,
    parameters: tool.inputSchema as TSchema,
    readOnly: tool.trusted && tool.annotations?.readOnlyHint === true,
    executionMode: "sequential",
    permission: {
      request: async () => ({
        capability: "mcp",
        risk: destructive ? "high" : "elevated",
        target,
        normalizedTarget: target,
        trusted: tool.trusted,
        destructive,
      }),
      preview: (args) => ({
        title: `MCP: ${tool.title ?? tool.name}`,
        description: `Call ${target}`,
        args: safePreviewArgs(args),
      }),
    },
    async execute(ctx: ToolExecutionContext<Record<string, unknown>>) {
      try {
        const raw = await caller.callTool(tool.name, ctx.args, { signal: ctx.signal });
        return adaptMcpToolResult(raw, limits);
      } catch (error) {
        return mcpErrorResult(error);
      }
    },
  };
}
