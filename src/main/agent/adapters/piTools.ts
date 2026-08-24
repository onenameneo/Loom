import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentTool as LoomAgentTool, ReadonlyAgentTool, ToolResult } from "../core/tool";
import { normalizeToolError } from "../core/tool";

const errorClassifications = new WeakMap<object, boolean>();

export function toPiResult(result: ToolResult): AgentToolResult<unknown> {
  const piResult: AgentToolResult<unknown> = {
    content: result.content,
    details: result.details,
    terminate: result.terminate,
  };
  if (result.isError !== undefined) errorClassifications.set(piResult, result.isError);
  return piResult;
}

/** Reads and consumes the adapter-only error classification before pi serializes the result. */
export function consumePiErrorClassification(result: AgentToolResult<unknown>): boolean | undefined {
  const classification = errorClassifications.get(result);
  errorClassifications.delete(result);
  return classification;
}

export function adaptAgentToolToPi(tool: LoomAgentTool): AgentTool<any> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: tool.executionMode,
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        const result = await tool.execute({
          toolCallId,
          args: params,
          signal,
          update: (partial) => onUpdate?.(toPiResult(partial)),
        });
        return toPiResult(result);
      } catch (error) {
        return toPiResult(normalizeToolError(tool.name, error));
      }
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
