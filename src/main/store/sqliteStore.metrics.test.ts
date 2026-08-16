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
    expect(reopened.listMetrics?.({ nodeId: node.id })).toEqual([expect.objectContaining({
      id: "metric-1",
      nodeId: node.id,
      sessionId: session.id,
      durationMs: 150,
      usage: expect.objectContaining({ totalTokens: 17, source: "provider" }),
    })]);
  });
});
