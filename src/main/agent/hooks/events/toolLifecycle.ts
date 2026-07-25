import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AgentHook, EventSinkPort } from "../../ports";
import { limitText } from "../../core/tool";

function summarize(value: unknown, limit = 900) {
  if (value == null) return "";
  if (typeof value === "string") return limitText(value, limit).text;
  const content = (value as any)?.content;
  if (Array.isArray(content)) {
    return limitText(
      content.map((c: any) => (c?.type === "text" ? c.text : c?.type ? `[${c.type}]` : "")).join("\n"),
      limit,
    ).text;
  }
  try {
    return limitText(JSON.stringify(value), limit).text;
  } catch {
    return limitText(String(value), limit).text;
  }
}

function boundedDetails(value: unknown, limit = 2000) {
  if (value == null) return undefined;
  try {
    const json = JSON.stringify(value);
    const limited = limitText(json, limit);
    return { json: limited.text, truncated: limited.truncation.truncated };
  } catch {
    const limited = limitText(String(value), limit);
    return { text: limited.text, truncated: limited.truncation.truncated };
  }
}

export function normalizeToolEvent(event: AgentEvent) {
  switch (event.type) {
    case "tool_execution_start":
      return {
        state: "start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: boundedDetails(event.args),
      };
    case "tool_execution_update":
      return {
        state: "update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarize(event.partialResult),
        details: boundedDetails(event.partialResult),
      };
    case "tool_execution_end":
      return {
        state: "end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        summary: summarize(event.result),
        details: boundedDetails((event.result as any)?.details),
      };
    default:
      return undefined;
  }
}

export function createToolLifecycleHook(events: EventSinkPort): AgentHook {
  return {
    name: "tool-lifecycle-events",
    onEvent(nodeId, event) {
      const normalized = normalizeToolEvent(event);
      if (normalized) events.emit(nodeId, "tool", normalized);
    },
  };
}
