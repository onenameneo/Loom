import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./sqliteStore";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStore metrics", () => {
  it("round-trips terminal telemetry metrics after reopening", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-metrics-"));
    dirs.push(dir);
    const file = join(dir, "loom.db");
    const first = new SqliteStore(file);
    const project = first.createProject("Project");
    const session = first.ensureDefaultSession(project.id);
    const node = first.createNode({ sessionId: session.id, title: "Root" });

    first.appendMetric({
      id: "metric-turn",
      nodeId: node.id,
      sessionId: session.id,
      turnId: "turn-1",
      kind: "turn",
      startedAt: 100,
      endedAt: 1_100,
      durationMs: 1_000,
      status: "ok",
      createdAt: 1_100,
    });

    first.appendMetric({
      id: "metric-1",
      nodeId: node.id,
      sessionId: session.id,
      turnId: "turn-1",
      requestId: "request-1",
      kind: "llm",
      providerId: "anthropic",
      modelId: "claude",
      startedAt: 100,
      endedAt: 250,
      durationMs: 150,
      ttftMs: 40,
      status: "ok",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 0,
        totalTokens: 17,
        exact: true,
        source: "provider",
      },
      createdAt: 250,
    });

    const reopened = new SqliteStore(file);
    expect(reopened.listMetrics?.({ nodeId: node.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "metric-1",
        nodeId: node.id,
        sessionId: session.id,
        durationMs: 150,
        usage: expect.objectContaining({ totalTokens: 17, source: "provider" }),
      }),
    ]));

    reopened.appendMetric({
      id: "metric-tool",
      nodeId: node.id,
      sessionId: session.id,
      turnId: "turn-1",
      toolCallId: "tool-1",
      kind: "tool",
      startedAt: 300,
      endedAt: 1_300,
      durationMs: 1_000,
      status: "ok",
      usage: {
        input: 100,
        output: 1_000,
        cacheRead: 100,
        cacheWrite: 0,
        totalTokens: 1_200,
        exact: true,
        source: "provider",
      },
      createdAt: 1_300,
    });
    expect(reopened.getMetricTotals?.({ nodeId: node.id })).toMatchObject({
      llmRequests: 1,
      durationMs: 1_000,
      ttftSamples: 1,
      outputTokensPerSecond: 5 / 0.15,
      usage: expect.objectContaining({ input: 10, output: 5, cacheRead: 2, totalTokens: 17 }),
    });
  });

  it("uses only measured TTFT samples for the average and does not double-count nested durations", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-metrics-"));
    dirs.push(dir);
    const store = new SqliteStore(join(dir, "loom.db"));
    const project = store.createProject("Project");
    const session = store.ensureDefaultSession(project.id);
    const node = store.createNode({ sessionId: session.id, title: "Root" });

    for (const metric of [
      { id: "turn", kind: "turn" as const, durationMs: 10_000 },
      { id: "llm-with-ttft", kind: "llm" as const, durationMs: 2_000, ttftMs: 400 },
      { id: "llm-without-ttft", kind: "llm" as const, durationMs: 1_000 },
      { id: "tool", kind: "tool" as const, durationMs: 5_000 },
    ]) {
      store.appendMetric({
        id: metric.id,
        nodeId: node.id,
        sessionId: session.id,
        kind: metric.kind,
        durationMs: metric.durationMs,
        ...(metric.ttftMs !== undefined ? { ttftMs: metric.ttftMs } : {}),
        status: "ok",
        createdAt: metric.durationMs,
      });
    }

    expect(store.getMetricTotals({ nodeId: node.id })).toMatchObject({
      durationMs: 10_000,
      ttftMs: 400,
      ttftSamples: 1,
    });
  });
});
