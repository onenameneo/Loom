import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryExtractionService, parseMemoryCommand } from "./extraction";
import { MemoryStore } from "./storage";

describe("memory extraction", () => {
  it("parses explicit remember and forget commands", () => {
    expect(parseMemoryCommand("/remember feedback 请使用中文")).toEqual({ kind: "remember", type: "feedback", content: "请使用中文" });
    expect(parseMemoryCommand("/forget mem_123")).toEqual({ kind: "forget", id: "mem_123" });
  });

  it("does not invoke a natural-language heuristic when extraction is not configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-extract-"));
    const service = new MemoryExtractionService(new MemoryStore({ rootDir: root }));
    const input = { sessionId: "s1", nodeId: "n1", projectId: "p1", userText: "以后请使用中文回答。" };
    const first = await service.afterTurn(input);
    expect(first.candidates).toHaveLength(0);
    expect(first.skipped).toBe(true);
    const second = await service.afterTurn(input);
    expect(second.skipped).toBe(true);
    expect(second.candidates).toHaveLength(0);
  });

  it("lets a restricted extractor create a candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-extract-"));
    const service = new MemoryExtractionService(new MemoryStore({ rootDir: root }), {
      run: async () => [{ type: "user", scope: { kind: "user" }, description: "Language", content: "Use English when asked.", confidence: 0.8 }],
    });
    const result = await service.afterTurn({ sessionId: "s1", nodeId: "n1", userText: "I prefer English when requested." });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].status).toBe("candidate");
  });

  it("skips a turn already written by the primary agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-extract-"));
    let calls = 0;
    const service = new MemoryExtractionService(new MemoryStore({ rootDir: root }), {
      run: async () => { calls += 1; return []; },
    });
    const result = await service.afterTurn({ sessionId: "s1", nodeId: "n1", userText: "I prefer English.", primaryMemoryWritten: true });
    expect(result.skipped).toBe(true);
    expect(calls).toBe(0);
  });

  it("turns a hanging restricted extractor into a non-fatal diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-extract-"));
    const service = new MemoryExtractionService(new MemoryStore({ rootDir: root }), {
      run: async () => new Promise(() => undefined),
    }, { maxDurationMs: 5 });
    const result = await service.afterTurn({ sessionId: "s1", nodeId: "n1", userText: "Please use English." });
    expect(result.error).toMatch(/timed out/);
    expect(result.candidates).toHaveLength(0);
  });
});
