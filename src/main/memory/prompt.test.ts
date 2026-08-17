import { describe, expect, it } from "vitest";
import { MemoryFileAccess } from "./fileAccess";
import { buildMemoryPrompt } from "./prompt";
import { MemoryStore } from "./storage";

describe("memory system prompt", () => {
  it("documents roots, durable-memory guidance, and write truthfulness", () => {
    const prompt = buildMemoryPrompt(new MemoryFileAccess(new MemoryStore({ rootDir: "/tmp/loom-memory" }), "project-a").descriptors());
    expect(prompt).toContain("memory:user");
    expect(prompt).toContain("memory:project");
    expect(prompt).toContain("memory:candidates");
    expect(prompt).toContain("explicitly asks");
    expect(prompt).toContain("ordinary conversation");
    expect(prompt).toContain("successful tool result is the only proof");
    expect(prompt).toContain("temporary task state");
  });
});
