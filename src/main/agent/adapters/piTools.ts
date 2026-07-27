import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentTool as LoomAgentTool, ReadonlyAgentTool, ToolResult } from "../core/tool";

function toPiResult(result: ToolResult): AgentToolResult<unknown> {
  if (result.isError) throw new Error(result.content.map((c) => (c.type === "text" ? c.text : `[image:${c.mimeType}]`)).join("\n"));
  return {
    content: result.content,
    details: result.details,
    terminate: result.terminate,
  };
}

export function adaptAgentToolToPi(tool: LoomAgentTool): AgentTool<any> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: tool.executionMode,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result = await tool.execute({
        toolCallId,
        args: params,
        signal,
        update: (partial) => onUpdate?.(toPiResult(partial)),
      });
      return toPiResult(result);
    },
  };
}

export const adaptReadonlyToolToPi = adaptAgentToolToPi;

export function adaptAgentToolsToPi(tools: LoomAgentTool[]): AgentTool<any>[] {
  return tools.map(adaptAgentToolToPi);
}

export function adaptReadonlyToolsToPi(tools: ReadonlyAgentTool[]): AgentTool<any>[] {
  return adaptAgentToolsToPi(tools);
}
