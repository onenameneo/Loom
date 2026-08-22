import { Type } from "typebox";
import type { AgentTool, ToolExecutionContext } from "../agent/core/tool";
import { textResult } from "../agent/core/tool";
import { normalizeMcpServerConfig, type McpServerConfig } from "./config";

export interface McpConfigToolOptions {
  targetPath: string;
  saveConfig: (input: unknown) => Promise<McpServerConfig>;
}

function previewConfig(input: unknown): Record<string, unknown> {
  const normalized = normalizeMcpServerConfig(input);
  if (!normalized.config) return { invalid: true, issues: normalized.issues.map((issue) => `${issue.path}: ${issue.message}`) };
  const config = normalized.config;
  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    transport: config.transport.type === "stdio"
      ? { type: "stdio", command: config.transport.command, args: config.transport.args, cwd: config.transport.cwd, environmentNames: Object.keys(config.transport.env ?? {}) }
      : { type: "streamable-http", url: config.transport.url, headerNames: Object.keys(config.transport.headers ?? {}) },
    exposure: config.exposure,
    approval: config.approval,
  };
}

export function createMcpConfigTool(options: McpConfigToolOptions): AgentTool<{ config: Record<string, unknown> }, unknown> {
  return {
    name: "mcp_save_config",
    label: "Save MCP configuration",
    description: "Add or update one MCP server through Loom's validated MCP configuration store. Use secret/environment references instead of plaintext credentials. This changes the global Loom MCP configuration and requires user approval.",
    parameters: Type.Object({
      config: Type.Record(Type.String(), Type.Unknown(), { description: "One MCP server configuration. It must include id, name, and a valid stdio or streamable-http transport." }),
    }),
    readOnly: false,
    permission: {
      request: () => ({
        capability: "external-mutation",
        risk: "high",
        target: options.targetPath,
        normalizedTarget: `external:${options.targetPath}`,
      }),
      preview: (args) => ({
        title: `Save MCP configuration: ${String(args.config.id ?? "unknown")}`,
        description: `Loom will validate and write this server to ${options.targetPath}. Plaintext sensitive headers are rejected.`,
        args: previewConfig(args.config),
      }),
    },
    async execute(ctx: ToolExecutionContext<{ config: Record<string, unknown> }>) {
      try {
        const saved = await options.saveConfig(ctx.args.config);
        return textResult(`MCP configuration saved: ${saved.id}. The server is enabled=${saved.enabled}; local stdio servers still require connection consent before they can start.`, {
          id: saved.id,
          revision: saved.revision,
          transport: saved.transport.type,
        });
      } catch (error) {
        return textResult(`MCP configuration was not saved: ${error instanceof Error ? error.message : String(error)}`, { error: String(error) }, true);
      }
    },
  };
}
