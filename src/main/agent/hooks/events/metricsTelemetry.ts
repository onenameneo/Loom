import type { AgentHook, AgentTelemetryEvent } from "../../ports";
import type { StorePort } from "../../ports";
import type { AgentMetricKind, AgentMetricRecord } from "../../../store/store";
import type { LlmUsage } from "../../core/usage";

type MetricDraft = {
  id: string;
  kind: AgentMetricKind;
  nodeId: string;
  sessionId: string;
  turnId?: string;
  requestId?: string;
  toolCallId?: string;
  providerId?: string;
  modelId?: string;
  name?: string;
  startedAt: number;
  ttftMs?: number;
  createdAt: number;
};

export function createMetricsTelemetryHook(deps: {
  store: Pick<StorePort, "appendMetric">;
  getSessionId(nodeId: string): string | undefined;
  now?: () => number;
}): AgentHook {
  const pending = new Map<string, MetricDraft>();
  const now = deps.now ?? Date.now;
  const draftKey = (kind: AgentMetricKind, nodeId: string, id: string) => `${kind}:${nodeId}:${id}`;
  const save = (draft: MetricDraft, input: { endedAt: number; status: AgentMetricRecord["status"]; durationMs?: number; usage?: LlmUsage }) => {
    deps.store.appendMetric?.({
      id: draft.id,
      nodeId: draft.nodeId,
      sessionId: draft.sessionId,
      ...(draft.turnId ? { turnId: draft.turnId } : {}),
      ...(draft.requestId ? { requestId: draft.requestId } : {}),
      ...(draft.toolCallId ? { toolCallId: draft.toolCallId } : {}),
      kind: draft.kind,
      ...(draft.providerId ? { providerId: draft.providerId } : {}),
      ...(draft.modelId ? { modelId: draft.modelId } : {}),
      ...(draft.name ? { name: draft.name } : {}),
      startedAt: draft.startedAt,
      endedAt: input.endedAt,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(draft.ttftMs !== undefined ? { ttftMs: draft.ttftMs } : {}),
      status: input.status,
      ...(input.usage ? { usage: input.usage } : {}),
      createdAt: draft.createdAt,
    });
  };

  return {
    name: "metrics-telemetry-persistence",
    onTelemetry(event: AgentTelemetryEvent) {
      const sessionId = deps.getSessionId(event.nodeId);
      if (!sessionId) return;
      if (event.type !== "turn_start" && event.type !== "turn_end" && !event.turnId) return;
      switch (event.type) {
        case "turn_start":
          pending.set(draftKey("turn", event.nodeId, event.turnId), { id: `metric:${event.nodeId}:turn:${event.turnId}`, kind: "turn", nodeId: event.nodeId, sessionId, turnId: event.turnId, name: event.operation, startedAt: event.at, createdAt: now() });
          return;
        case "turn_end": {
          const key = draftKey("turn", event.nodeId, event.turnId);
          const draft = pending.get(key);
          pending.delete(key);
          if (draft) save(draft, { endedAt: event.at, status: event.status, durationMs: event.durationMs });
          for (const [pendingKey, child] of pending) {
            if (child.nodeId === event.nodeId && child.turnId === event.turnId) pending.delete(pendingKey);
          }
          return;
        }
        case "llm_start":
          pending.set(draftKey("llm", event.nodeId, event.requestId), { id: `metric:${event.nodeId}:llm:${event.requestId}`, kind: "llm", nodeId: event.nodeId, sessionId, turnId: event.turnId, requestId: event.requestId, providerId: event.providerId, modelId: event.modelId, name: `${event.providerId}/${event.modelId}`, startedAt: event.at, createdAt: now() });
          return;
        case "llm_first_token": {
          const draft = pending.get(draftKey("llm", event.nodeId, event.requestId));
          if (draft && event.ttftMs !== undefined) draft.ttftMs = event.ttftMs;
          return;
        }
        case "llm_end": {
          const key = draftKey("llm", event.nodeId, event.requestId);
          const draft = pending.get(key);
          pending.delete(key);
          if (draft) {
            if (event.ttftMs !== undefined) draft.ttftMs = event.ttftMs;
            save(draft, { endedAt: event.at, status: event.status, durationMs: event.durationMs, usage: event.usage });
          }
          return;
        }
        case "tool_start":
          pending.set(draftKey("tool", event.nodeId, event.toolCallId), { id: `metric:${event.nodeId}:tool:${event.toolCallId}`, kind: "tool", nodeId: event.nodeId, sessionId, turnId: event.turnId, toolCallId: event.toolCallId, name: event.toolName, startedAt: event.at, createdAt: now() });
          return;
        case "tool_end": {
          const key = draftKey("tool", event.nodeId, event.toolCallId);
          const draft = pending.get(key);
          pending.delete(key);
          if (draft) save(draft, { endedAt: event.at, status: event.status, durationMs: event.durationMs, usage: event.usage });
          return;
        }
        case "compaction_start":
          pending.set(draftKey("compaction", event.nodeId, event.compactionId), { id: `metric:${event.nodeId}:compaction:${event.compactionId}`, kind: "compaction", nodeId: event.nodeId, sessionId, turnId: event.turnId, name: "compaction", startedAt: event.at, createdAt: now() });
          return;
        case "compaction_end": {
          const key = draftKey("compaction", event.nodeId, event.compactionId);
          const draft = pending.get(key);
          pending.delete(key);
          if (draft) save(draft, { endedAt: event.at, status: event.status, durationMs: event.durationMs, usage: event.usage });
          return;
        }
      }
    },
  };
}
