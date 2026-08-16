import type { AgentHook, AgentTelemetryEvent } from "../../ports";
import type { TraceRepository } from "../../app/traceRepository";

function key(nodeId: string, id: string): string {
  return `${nodeId}:${id}`;
}

/** Projects normalized telemetry into the existing bounded trace tree. */
export function createTraceTelemetryHook(traces: TraceRepository): AgentHook {
  const llmSpans = new Map<string, string>();
  const toolSpans = new Map<string, string>();
  const compactionSpans = new Map<string, string>();

  return {
    name: "trace-telemetry-projection",
    onTelemetry(event: AgentTelemetryEvent) {
      switch (event.type) {
        case "turn_start":
          traces.startTurn({ nodeId: event.nodeId, turnId: event.turnId, operation: event.operation });
          return;
        case "turn_end":
          traces.finishTurn(event.nodeId, event.turnId, event.status);
          return;
        case "llm_start": {
          if (!event.turnId) return;
          const spanId = traces.beginSpan({
            nodeId: event.nodeId,
            turnId: event.turnId,
            kind: "llm_call",
            name: `${event.providerId}/${event.modelId}`,
            attributes: {
              model: { provider: event.providerId, id: event.modelId },
              ...(event.attributes ?? {}),
            },
          });
          if (spanId) llmSpans.set(key(event.nodeId, event.requestId), spanId);
          return;
        }
        case "llm_end": {
          if (!event.turnId) return;
          const spanId = llmSpans.get(key(event.nodeId, event.requestId));
          if (!spanId) return;
          traces.endSpan(event.nodeId, event.turnId, spanId, {
            status: event.status,
            attributes: {
              ...(event.usage ? { usage: event.usage } : {}),
              ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
              ...(event.ttftMs !== undefined ? { ttftMs: event.ttftMs } : {}),
              ...(event.attributes ?? {}),
            },
          });
          return;
        }
        case "tool_start": {
          if (!event.turnId) return;
          const parentSpanId = event.parentRequestId ? llmSpans.get(key(event.nodeId, event.parentRequestId)) : undefined;
          const spanId = traces.beginSpan({
            nodeId: event.nodeId,
            turnId: event.turnId,
            kind: "tool",
            name: event.toolName,
            parentSpanId,
            attributes: { toolCallId: event.toolCallId, ...(event.attributes ?? {}) },
          });
          if (spanId) toolSpans.set(key(event.nodeId, event.toolCallId), spanId);
          return;
        }
        case "tool_end": {
          if (!event.turnId) return;
          const spanId = toolSpans.get(key(event.nodeId, event.toolCallId));
          toolSpans.delete(key(event.nodeId, event.toolCallId));
          if (!spanId) return;
          traces.endSpan(event.nodeId, event.turnId, spanId, {
            status: event.status,
            attributes: {
              ...(event.usage ? { usage: event.usage } : {}),
              ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
              ...(event.attributes ?? {}),
            },
          });
          return;
        }
        case "compaction_start": {
          if (!event.turnId) return;
          const spanId = traces.beginSpan({
            nodeId: event.nodeId,
            turnId: event.turnId,
            kind: "compaction",
            name: "compaction",
            attributes: event.attributes,
          });
          if (spanId) compactionSpans.set(key(event.nodeId, event.compactionId), spanId);
          return;
        }
        case "compaction_end": {
          if (!event.turnId) return;
          const spanId = compactionSpans.get(key(event.nodeId, event.compactionId));
          compactionSpans.delete(key(event.nodeId, event.compactionId));
          if (!spanId) return;
          traces.endSpan(event.nodeId, event.turnId, spanId, {
            status: event.status,
            attributes: {
              ...(event.usage ? { usage: event.usage } : {}),
              ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
              ...(event.attributes ?? {}),
            },
          });
          return;
        }
        case "llm_first_token":
          return;
      }
    },
  };
}
