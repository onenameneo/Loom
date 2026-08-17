import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTODREAM_MIN_SESSIONS, AutoDreamService } from "./autodream";
import { MemoryExtractionService } from "./extraction";
import { MemoryFileAccess } from "./fileAccess";
import { MemoryRetriever } from "./retrieval";
import { MemoryStore } from "./storage";

describe("cross-session memory flow", () => {
  it("remembers, recalls, extracts, approves and archives through maintenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-memory-flow-"));
    let now = 1_000;
    const store = new MemoryStore({ rootDir: root, now: () => now });
    const userAccess = new MemoryFileAccess(store, "project-a");
    await store.remember({ type: "user", scope: { kind: "user" }, description: "Neo", content: "The user is Neo.", source: { trigger: "explicit", sessionId: "s1", nodeId: "n1" } });
    const explicit = await store.remember({ type: "project", scope: { kind: "project", projectId: "loom" }, description: "Canonical memory source", content: "Markdown is the canonical source.", source: { trigger: "explicit", sessionId: "s1" } });
    const retriever = new MemoryRetriever(store);
    expect((await retriever.retrieve("s2", { text: "canonical Markdown", projectId: "loom" })).memories[0].record.id).toBe(explicit.id);
    expect((await retriever.retrieve("s3", { text: "Neo", projectId: "another-project" })).memories.map((item) => item.record.description)).toContain("Neo");
    expect((await retriever.retrieve("s4", { text: "canonical Markdown", projectId: "another-project" })).memories.some((item) => item.record.id === explicit.id)).toBe(false);
    expect(userAccess.descriptors().find((item) => item.id === "memory:project")?.displayPath).toContain("project-a");

    const extraction = new MemoryExtractionService(store, {
      run: async () => [{ type: "feedback", scope: { kind: "project", projectId: "loom" }, description: "Response language", content: "Answer in Chinese by default.", confidence: 0.8 }],
    });
    const extracted = await extraction.afterTurn({ sessionId: "s2", nodeId: "n2", projectId: "loom", userText: "Please answer in Chinese by default." });
    expect(extracted.candidates).toHaveLength(1);
    const approved = await store.approveCandidate(extracted.candidates[0].id);
    expect(approved?.status).toBe("active");

    now = 2 * 24 * 60 * 60_000;
    await store.writeOperationalState({ version: 1, newSessions: AUTODREAM_MIN_SESSIONS });
    const dream = new AutoDreamService(store, () => now, {
      consolidate: async () => [{
        sources: [explicit.id, approved!.id],
        replacement: { description: "Durable Loom memory", content: "Markdown remains the readable canonical source; answer in Chinese by default.", type: "project" },
      }],
    });
    const result = await dream.run(true);
    expect(result?.archived).toEqual(expect.arrayContaining([explicit.id, approved!.id]));
    expect((await store.stats()).archived).toBe(2);
  });
});
