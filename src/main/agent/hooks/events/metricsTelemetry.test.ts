import { describe, expect, it, vi } from "vitest";
import type { AgentMetricRecord } from "../../../store/store";
import type { AgentTelemetryEvent } from "../../ports";
import { createMetricsTelemetryHook } from "./metricsTelemetry";

describe("createMetricsTelemetryHook", () => {
  it("discards child drafts left behind when their turn has ended", () => {
    const records: AgentMetricRecord[] = [];
    const hook = createMetricsTelemetryHook({
      store: { appendMetric: (record) => records.push(record) },
      getSessionId: () => "s1",
      now: () => 100,
    });
    const emit = (event: AgentTelemetryEvent) => hook.onTelemetry?.(event);

    emit({ type: "turn_start", nodeId: "n1", turnId: "t1", operation: "send", at: 1 });
    emit({ type: "llm_start", nodeId: "n1", turnId: "t1", requestId: "r1", providerId: "p", modelId: "m", at: 2 });
    emit({ type: "turn_end", nodeId: "n1", turnId: "t1", operation: "send", status: "aborted", at: 3, durationMs: 2 });
    emit({ type: "llm_end", nodeId: "n1", turnId: "t1", requestId: "r1", providerId: "p", modelId: "m", status: "ok", at: 4 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "turn", status: "aborted" });
  });

  it("persists the normalized LLM usage once at the terminal event", () => {
    const appendMetric = vi.fn();
    const hook = createMetricsTelemetryHook({ store: { appendMetric }, getSessionId: () => "s1" });
    const emit = (event: AgentTelemetryEvent) => hook.onTelemetry?.(event);

    emit({ type: "llm_start", nodeId: "n1", turnId: "t1", requestId: "r1", providerId: "p", modelId: "m", at: 2 });
    emit({
      type: "llm_end",
      nodeId: "n1",
      turnId: "t1",
      requestId: "r1",
      providerId: "p",
      modelId: "m",
      status: "ok",
      at: 4,
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, exact: true, source: "provider" },
    });

    expect(appendMetric).toHaveBeenCalledOnce();
    expect(appendMetric.mock.calls[0][0]).toMatchObject({ kind: "llm", usage: { input: 10, output: 5, totalTokens: 17 } });
  });

  it("ignores unscoped child events just like the trace projection", () => {
    const appendMetric = vi.fn();
    const hook = createMetricsTelemetryHook({ store: { appendMetric }, getSessionId: () => "s1" });

    hook.onTelemetry?.({ type: "llm_start", nodeId: "n1", requestId: "r1", providerId: "p", modelId: "m", at: 2 });
    hook.onTelemetry?.({ type: "llm_end", nodeId: "n1", requestId: "r1", providerId: "p", modelId: "m", status: "ok", at: 3 });

    expect(appendMetric).not.toHaveBeenCalled();
  });
});
