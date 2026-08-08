import { describe, expect, it } from "vitest";
import { createTraceRepository, sanitizeTraceValue, type TraceEvent } from "./traceRepository";

describe("sanitizeTraceValue", () => {
  it("redacts nested credentials and marks an oversized value", () => {
    const value = sanitizeTraceValue(
      { nested: { apiKey: "secret", note: "x".repeat(80) } },
      { maxTextLength: 24 },
    );

    expect(value).toMatchObject({
      nested: { apiKey: "[REDACTED]", note: expect.objectContaining({ truncated: true }) },
    });
  });

  it("redacts credential fields without hiding ordinary token telemetry", () => {
    expect(sanitizeTraceValue({ token: "secret", totalTokens: 123, cacheTokens: 45 })).toEqual({
      token: "[REDACTED]",
      totalTokens: 123,
      cacheTokens: 45,
    });
  });

  it("keeps image metadata while omitting its binary body", () => {
    expect(sanitizeTraceValue({ type: "image", mimeType: "image/png", data: "a".repeat(64) })).toEqual({
      type: "image",
      mimeType: "image/png",
      data: { omitted: "binary", bytes: 64 },
    });
  });

  it("bounds large arrays and deep objects", () => {
    expect(sanitizeTraceValue({ items: Array.from({ length: 8 }, (_, index) => ({ index })) }, { maxArrayLength: 3 })).toEqual({
      items: [{ index: 0 }, { index: 1 }, { index: 2 }, { omitted: 5 }],
    });

    expect(sanitizeTraceValue({ a: { b: { c: { d: "too deep" } } } }, { maxDepth: 2 })).toEqual({
      a: { b: { truncated: "depth" } },
    });
  });
});

describe("createTraceRepository span lifecycle", () => {
  function repo() {
    const events: TraceEvent[] = [];
    const traces = createTraceRepository({ now: () => 100 });
    traces.subscribe((event) => events.push(event));
    return { traces, events };
  }

  it("creates a turn root span and builds child spans with parent fallback", () => {
    const { traces } = repo();
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    const llmId = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "p/m", attributes: { model: { provider: "p", id: "m" } } });
    const toolId = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "tool", name: "calc", parentSpanId: llmId, attributes: { args: { expr: "1+1" } } });

    const snapshot = traces.snapshot("n1");
    const record = snapshot.records[0];
    const [turn, llm, tool] = record.spans;
    expect(turn).toMatchObject({ kind: "turn", name: "send", status: "pending" });
    expect(llm).toMatchObject({ kind: "llm_call", parentSpanId: turn.spanId, status: "pending" });
    expect(tool).toMatchObject({ kind: "tool", parentSpanId: llmId, status: "pending" });

    // 无 parentSpanId → 回落 turn 根
    const orphan = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "compaction", name: "compact" });
    expect(snapshot.records[0].spans.find((s) => s.spanId === orphan)?.parentSpanId).toBe(turn.spanId);
  });

  it("ends spans by id with status and attributes merged", () => {
    const { traces } = repo();
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    const llmId = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "p/m", attributes: { model: "p/m" } })!;
    traces.endSpan("n1", "t1", llmId, { status: "ok", attributes: { usage: { totalTokens: 10 } } });

    const [turn, llm] = traces.snapshot("n1").records[0].spans;
    expect(llm).toMatchObject({ status: "ok", endedAt: 100, attributes: { model: "p/m", usage: { totalTokens: 10 } } });
    expect(turn.status).toBe("pending");
  });

  it("is a no-op for an unknown span id or record", () => {
    const { traces, events } = repo();
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    traces.endSpan("n1", "t1", "missing", { status: "ok" });
    traces.beginSpan({ nodeId: "n1", turnId: "t9", kind: "llm_call", name: "m" });
    expect(events).toHaveLength(1); // 只有 turn_start
  });

  it("finishTurn marks the root done and aborts any pending spans", () => {
    const { traces } = repo();
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    const llmId = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "p/m" })!;
    traces.endSpan("n1", "t1", llmId, { status: "ok" });
    const stuck = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "tool", name: "bash" })!;

    traces.finishTurn("n1", "t1", "error");

    const record = traces.snapshot("n1").records[0];
    expect(record.status).toBe("error");
    expect(record.spans.find((s) => s.kind === "turn")?.status).toBe("error");
    expect(record.spans.find((s) => s.spanId === stuck)?.status).toBe("aborted");
    expect(record.spans.find((s) => s.spanId === stuck)?.endedAt).toBe(100);
  });

  it("updates turn attributes and emits turn_update", () => {
    const { traces, events } = repo();
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    traces.updateTurn("n1", "t1", { approval: { requestId: "r1" } });

    const root = traces.snapshot("n1").records[0].spans[0];
    expect(root.attributes).toMatchObject({ operation: "send", approval: { requestId: "r1" } });
    expect(events.at(-1)?.type).toBe("turn_update");
  });
});

describe("createTraceRepository incremental protocol", () => {
  it("emits revisioned events in order", () => {
    const events: TraceEvent[] = [];
    const traces = createTraceRepository({ now: () => 1 });
    traces.subscribe((event) => events.push(event));

    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    const llmId = traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "m" })!;
    traces.endSpan("n1", "t1", llmId, { status: "ok" });
    traces.finishTurn("n1", "t1", "ok");

    expect(events.map((event) => event.type)).toEqual(["turn_start", "span", "span_end", "turn_end"]);
    expect(events.map((event) => event.revision)).toEqual([1, 2, 3, 4]);
  });

  it("redacts sensitive span attributes", () => {
    const traces = createTraceRepository({ now: () => 1 });
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    traces.beginSpan({
      nodeId: "n1",
      turnId: "t1",
      kind: "tool",
      name: "webfetch",
      attributes: { headers: { authorization: "Bearer abc" }, url: "https://example.com" },
    });

    const span = traces.snapshot("n1").records[0].spans[1];
    expect(span.attributes).toEqual({
      headers: { authorization: "[REDACTED]" },
      url: "https://example.com",
    });
  });

  it("truncates the oldest span beyond the per-record bound and marks truncated", () => {
    const traces = createTraceRepository({ now: () => 1, maxSpansPerRecord: 3 });
    traces.startTurn({ nodeId: "n1", turnId: "t1", operation: "send" });
    traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "m1" });
    traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "m2" });
    traces.beginSpan({ nodeId: "n1", turnId: "t1", kind: "llm_call", name: "m3" });

    const record = traces.snapshot("n1").records[0];
    expect(record.truncated).toBe(true);
    expect(record.spans.map((span) => span.name)).toEqual(["m1", "m2", "m3"]);
  });

  it("evicts the oldest completed records beyond the per-node bound", () => {
    const traces = createTraceRepository({ now: () => 1, maxCompletedPerNode: 2 });
    for (let index = 1; index <= 3; index += 1) {
      traces.startTurn({ nodeId: "n1", turnId: `t${index}`, operation: "send" });
      traces.finishTurn("n1", `t${index}`, "ok");
    }
    expect(traces.snapshot("n1").records.map((record) => record.turnId)).toEqual(["t3", "t2"]);
  });
});
