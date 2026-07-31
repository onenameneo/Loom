import { describe, expect, it } from "vitest";
import { createTraceRepository, sanitizeTraceValue } from "./traceRepository";

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

describe("createTraceRepository", () => {
  it("keeps ordered entries and evicts the oldest completed turn", () => {
    const traces = createTraceRepository({ maxCompletedPerNode: 1, now: () => 10 });
    traces.start({ nodeId: "node-1", turnId: "turn-1", operation: "send" });
    traces.append("node-1", "turn-1", "request", { prompt: "one" });
    traces.finish("node-1", "turn-1", "completed");
    traces.start({ nodeId: "node-1", turnId: "turn-2", operation: "send" });
    traces.append("node-1", "turn-2", "response", { text: "two" });
    traces.finish("node-1", "turn-2", "completed");

    const snapshot = traces.snapshot("node-1");
    expect(snapshot.records.map((record) => record.turnId)).toEqual(["turn-2"]);
    expect(snapshot.records[0].entries.map((entry) => entry.kind)).toEqual(["turn", "response", "turn"]);
    expect(snapshot.sequence).toBeGreaterThan(0);
  });

  it("bounds entries kept for one active turn and marks the record as truncated", () => {
    const traces = createTraceRepository({ maxEntriesPerRecord: 2, now: () => 10 });
    traces.start({ nodeId: "node-1", turnId: "turn-1", operation: "send" });
    traces.append("node-1", "turn-1", "event", { step: 1 });
    traces.append("node-1", "turn-1", "event", { step: 2 });

    const [record] = traces.snapshot("node-1").records;
    expect(record.entries).toHaveLength(2);
    expect(record.truncated).toBe(true);
  });

  it("publishes monotonic node snapshots for live consumers", () => {
    const traces = createTraceRepository({ now: () => 10 });
    const snapshots: number[] = [];
    const stop = traces.subscribe((snapshot) => snapshots.push(snapshot.sequence));
    traces.start({ nodeId: "node-1", turnId: "turn-1", operation: "send" });
    traces.append("node-1", "turn-1", "request", { prompt: "one" });
    stop();
    traces.finish("node-1", "turn-1", "completed");

    expect(snapshots).toEqual([1, 2]);
  });
});
