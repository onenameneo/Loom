import { describe, expect, it } from "vitest";
import { createTraceRepository } from "../../app/traceRepository";
import type { AgentTelemetryEvent } from "../../ports";
import { createTraceTelemetryHook } from "./traceTelemetry";

describe("createTraceTelemetryHook", () => {
  it("releases an ended LLM mapping before later spans use the request id", () => {
    const traces = createTraceRepository({ now: () => 100 });
    const hook = createTraceTelemetryHook(traces);
    const emit = (event: AgentTelemetryEvent) => hook.onTelemetry?.(event);

    emit({ type: "turn_start", nodeId: "n1", turnId: "t1", operation: "send", at: 1 });
    emit({ type: "llm_start", nodeId: "n1", turnId: "t1", requestId: "r1", providerId: "p", modelId: "m", at: 2 });
    emit({ type: "llm_end", nodeId: "n1", turnId: "t1", requestId: "r1", providerId: "p", modelId: "m", status: "ok", at: 3 });
    emit({ type: "tool_start", nodeId: "n1", turnId: "t1", toolCallId: "c1", toolName: "calc", parentRequestId: "r1", at: 4 });

    const [turn, llm, tool] = traces.snapshot("n1").records[0].spans;
    expect(llm.status).toBe("ok");
    expect(tool.parentSpanId).toBe(turn.spanId);
  });
});
