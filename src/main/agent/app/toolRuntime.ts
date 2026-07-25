import type { ReadonlyAgentTool, ToolExecutionContext, ToolResult } from "../core/tool";
import { normalizeToolError } from "../core/tool";

export interface ToolRegistry {
  register(tool: ReadonlyAgentTool): void;
  list(): ReadonlyAgentTool[];
  get(name: string): ReadonlyAgentTool | undefined;
  execute(name: string, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export function createToolRegistry(initialTools: ReadonlyAgentTool[] = []): ToolRegistry {
  const tools = new Map<string, ReadonlyAgentTool>();

  const registry: ToolRegistry = {
    register(tool) {
      if (!tool.name || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tool.name)) {
        throw new Error(`Invalid tool name: ${tool.name}`);
      }
      if (tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      if (tool.readOnly !== true) throw new Error(`Tool must be read-only: ${tool.name}`);
      tools.set(tool.name, tool);
    },

    list() {
      return [...tools.values()];
    },

    get(name) {
      return tools.get(name);
    },

    async execute(name, ctx) {
      const tool = tools.get(name);
      if (!tool) return normalizeToolError(name, new Error("Tool not found"));
      try {
        return await tool.execute(ctx);
      } catch (err) {
        return normalizeToolError(name, err);
      }
    },
  };

  for (const tool of initialTools) registry.register(tool);
  return registry;
}
