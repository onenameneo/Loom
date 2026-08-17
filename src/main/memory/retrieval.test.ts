import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMemoryReminder, scoreMemory, selectMemories } from "./retrieval";
import { MemoryRetriever } from "./retrieval";
import { MemoryStore } from "./storage";
import type { MemoryRecord } from "./types";

function memory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    type: "project",
    scope: { kind: "project", projectId: "loom" },
    status: "active",
    confidence: 0.9,
    description: id,
    content: `The ${id} project uses Markdown memory files.`,
    source: { trigger: "manual" },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("long-term memory retrieval", () => {
  it("ranks matching project context above unrelated user context", () => {
    const project = memory("markdown", { content: "Markdown is the canonical source." });
    const unrelated = memory("unrelated", { scope: { kind: "user" }, content: "A different topic." });
    expect(scoreMemory(project, { text: "Markdown canonical", projectId: "loom" })).toBeGreaterThan(scoreMemory(unrelated, { text: "Markdown canonical", projectId: "loom" }));
  });

  it("bounds selection to five records and a byte budget", () => {
    const selected = selectMemories(Array.from({ length: 8 }, (_, index) => memory(`memory-${index}`)), { projectId: "loom", maxRecords: 5, maxBytes: 1_200 });
    expect(selected.length).toBeLessThanOrEqual(5);
    expect(selected.length).toBeGreaterThan(0);
  });

  it("marks stale and conflicted records in the reminder", () => {
    const selected = selectMemories([
      memory("old", { updatedAt: 1, lastConfirmedAt: 1 }),
      memory("conflict", { status: "conflicted" }),
    ], { projectId: "loom", now: 100 * 24 * 60 * 60_000 });
    const reminder = formatMemoryReminder(selected);
    expect(reminder).toContain("warning=stale");
    expect(reminder).toContain("warning=conflicted");
  });

  it("does not surface an unchanged memory twice in one session", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-retrieval-"));
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    await store.remember({ type: "user", scope: { kind: "user" }, description: "Language", content: "Use Chinese.", source: { trigger: "manual" } });
    const retriever = new MemoryRetriever(store);
    const first = await retriever.retrieve("session-1", { text: "language", projectId: "project" });
    const second = await retriever.retrieve("session-1", { text: "language", projectId: "project" });
    expect(first.memories).toHaveLength(1);
    expect(second.memories).toHaveLength(0);
  });
});
