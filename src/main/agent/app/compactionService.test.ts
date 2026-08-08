import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createCompactionService } from "./compactionService";
import { createLoomContextCheckpoint } from "../core/messages";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const assistant = (text: string): AgentMessage => ({ role: "assistant", content: text, timestamp: 0 }) as unknown as AgentMessage;

describe("CompactionService", () => {
  it("plans compaction with explicit dependencies and emits bounded diagnostics", () => {
    const events: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
    const traces: unknown[] = [];
    const service = createCompactionService({
      summarize: vi.fn(),
      store: { appendMessages: vi.fn() },
      clock: { now: () => 10 },
      ids: { message: () => "cp-1" },
      syncEngine: vi.fn(),
      trace: { beginSpan: (input) => { traces.push({ op: 'begin', ...input }); return 'span-'+traces.length; }, endSpan: (_nodeId, _turnId, spanId, input) => traces.push({ op: 'end', spanId, ...input }) },
      events: { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) },
    });

    const plan = service.planNodeCompaction({
      nodeId: "n1",
      turnId: "t1",
      trigger: "threshold",
      messages: [user("u1 " + "x".repeat(100)), assistant("a1 " + "x".repeat(100)), user("u2"), assistant("a2")],
      tailBudgetTokens: 4,
    });

    expect(plan).toMatchObject({ kind: "retain-tail", compactThroughSeq: 1, retainedFromSeq: 2 });
    expect(events).toEqual([
      {
        nodeId: "n1",
        type: "compaction",
        payload: expect.objectContaining({ state: "planned", trigger: "threshold", compactThroughSeq: 1 }),
      },
    ]);
    // planNodeCompaction 是 plan-only，不写 span；compactNode 才 begin/end compaction span。
    expect(traces).toEqual([]);
  });

  it("persists a checkpoint only after a valid summary is returned", async () => {
    const appendMessages = vi.fn();
    const syncEngine = vi.fn();
    const service = createCompactionService({
      summarize: vi.fn(async () => ({
        summary: "## Goal\nKeep context bounded.",
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, exact: true },
      })),
      store: { appendMessages },
      clock: { now: () => 20 },
      ids: { message: () => "cp-1" },
      syncEngine,
      trace: { beginSpan: vi.fn(), endSpan: vi.fn() },
      events: { emit: vi.fn() },
    });

    const result = await service.compactNode({
      nodeId: "n1",
      turnId: "t1",
      trigger: "threshold",
      messages: [user("u1 " + "x".repeat(100)), assistant("a1 " + "x".repeat(100)), user("u2"), assistant("a2")],
      tailBudgetTokens: 4,
      tokenCounter: (_message, index) => 2,
      signal: new AbortController().signal,
    });

    expect(result.ok).toBe(true);
    const checkpoint = result.ok ? result.checkpoint : undefined;
    expect(checkpoint).toMatchObject({
      role: "loomContextCheckpoint",
      id: "cp-1",
      reason: "threshold",
      summary: "## Goal\nKeep context bounded.",
      coverage: { fromSeq: 0, toSeq: 1 },
      retainedTail: { fromSeq: 2, toSeq: 3 },
      summaryUsage: { totalTokens: 14, exact: true },
    });
    expect(checkpoint?.diagnostics.before.tokens).toBeGreaterThan(0);
    expect(checkpoint?.diagnostics.before.tokens).not.toBe(4);
    expect(checkpoint?.diagnostics.after.tokens).not.toBe(3);
    expect(appendMessages).toHaveBeenCalledWith("n1", [expect.objectContaining({ id: "cp-1", role: "loomContextCheckpoint" })]);
    expect(syncEngine).toHaveBeenCalledWith("n1");
  });

  it("does not persist a checkpoint when summarization fails or returns an empty summary", async () => {
    const appendMessages = vi.fn();
    const service = createCompactionService({
      summarize: vi.fn(async () => ({ summary: "   " })),
      store: { appendMessages },
      clock: { now: () => 20 },
      ids: { message: () => "cp-1" },
      syncEngine: vi.fn(),
      trace: { beginSpan: vi.fn(), endSpan: vi.fn() },
      events: { emit: vi.fn() },
    });

    await expect(service.compactNode({
      nodeId: "n1",
      trigger: "threshold",
      messages: [user("u1"), assistant("a1"), user("u2"), assistant("a2")],
      tailBudgetTokens: 4,
      tokenCounter: (_message, index) => 2,
    })).resolves.toEqual({ ok: false, reason: "empty_summary" });
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it("does not persist a checkpoint when the compaction signal is aborted before persistence", async () => {
    const appendMessages = vi.fn();
    const controller = new AbortController();
    const service = createCompactionService({
      summarize: vi.fn(async () => {
        controller.abort();
        return { summary: "## Goal\nlate summary" };
      }),
      store: { appendMessages },
      clock: { now: () => 20 },
      ids: { message: () => "cp-1" },
      syncEngine: vi.fn(),
      trace: { beginSpan: vi.fn(), endSpan: vi.fn() },
      events: { emit: vi.fn() },
    });

    await expect(service.compactNode({
      nodeId: "n1",
      trigger: "threshold",
      messages: [user("u1"), assistant("a1"), user("u2"), assistant("a2")],
      tailBudgetTokens: 4,
      tokenCounter: (_message, index) => 2,
      signal: controller.signal,
    })).resolves.toEqual({ ok: false, reason: "aborted" });
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it("summarizes only the newly displaced tail plus the previous checkpoint", async () => {
    const summarize = vi.fn(async () => ({ summary: "merged" }));
    const previous = createLoomContextCheckpoint({
      id: "cp-old", nodeId: "n1", createdAt: 1, reason: "threshold", summary: "old summary",
      coverage: { fromSeq: 0, toSeq: 8 }, retainedTail: { fromSeq: 10, toSeq: 13 },
      diagnostics: { before: { tokens: 100, exact: false }, after: { tokens: 20, exact: false } },
    });
    const service = createCompactionService({
      summarize, store: { appendMessages: vi.fn() }, clock: { now: () => 20 }, ids: { message: () => "cp-new" },
      syncEngine: vi.fn(), trace: { beginSpan: vi.fn(), endSpan: vi.fn() }, events: { emit: vi.fn() },
    });
    const result = await service.compactNode({
      nodeId: "n1", trigger: "threshold", previousCheckpoint: previous, sourceOffset: 10,
      messages: [user("u"), assistant("a"), user("u2"), assistant("a2")], tailBudgetTokens: 4,
      tokenCounter: () => 2,
    });
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      previousCheckpointSummary: "old summary",
      transcript: expect.objectContaining({ range: { fromSeq: 0, toSeq: 1 } }),
    }), expect.anything());
    expect(result).toMatchObject({ ok: true, checkpoint: { coverage: { fromSeq: 10, toSeq: 11 } } });
  });
});
