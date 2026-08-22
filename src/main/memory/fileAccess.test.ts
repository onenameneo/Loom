import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownForRecord } from "./markdown";
import { MemoryFileAccess, FileRootRegistry } from "./fileAccess";
import { MemoryStore, defaultMemoryRoot } from "./storage";
import type { MemoryRecord } from "./types";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "loom-memory-access-"));
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_access",
    type: "user",
    scope: { kind: "user" },
    status: "active",
    confidence: 0.9,
    description: "Neo prefers concise answers",
    content: "Prefer concise answers unless depth is requested.",
    source: { trigger: "explicit", sessionId: "s1", nodeId: "n1" },
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

describe("MemoryFileAccess", () => {
  it("maps logical roots and delegates active Markdown writes to MemoryStore", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    const written: string[] = [];
    const access = new MemoryFileAccess(store, "project-a", (item) => written.push(item.id));
    const roots = access.descriptors();
    expect(roots.map((item) => item.id)).toEqual(["memory:user", "memory:project", "memory:candidates", "memory:archive"]);
    expect(new FileRootRegistry({ sourceRoots: ["/tmp/source"], memory: access }).roots.map((item) => item.id)).toEqual([
      "project:0", "memory:user", "memory:project", "memory:candidates", "memory:archive",
    ]);

    const saved = await access.write({ root: "memory:user", path: "user/mem_access.md", content: markdownForRecord(record()), overwrite: false });
    expect(saved.record).toMatchObject({ id: "mem_access", status: "active", scope: { kind: "user" } });
    expect(written).toEqual(["mem_access"]);
    expect((await store.scan()).issues).toEqual([]);
    expect((await access.read({ root: "memory:user", path: "user/mem_access.md" })).text).toContain("Neo prefers concise answers");
  });

  it("enforces project scope, supports bounded edit, and preserves the generated index", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    const access = new MemoryFileAccess(store, "project-a");
    const project = record({
      id: "project_fact",
      type: "project",
      scope: { kind: "project", projectId: "project-a" },
      description: "Project convention",
      content: "Use Markdown as the source of truth.",
    });
    const saved = await access.write({ root: "memory:project", path: "project/project_fact.md", content: markdownForRecord(project) });
    await expect(access.edit({ root: "memory:project", path: "project/project_fact.md", oldText: "Markdown as the source", newText: "Markdown is the canonical" })).rejects.toThrow(/expectedVersion/i);
    const version = (await access.read({ root: "memory:project", path: "project/project_fact.md" })).version;
    const edited = await access.edit({ root: "memory:project", path: "project/project_fact.md", oldText: "Markdown as the source", newText: "Markdown is the canonical", expectedVersion: version });
    expect(edited.record?.content).toContain("Markdown is the canonical");
    expect(edited.version).toBeTruthy();
    expect(saved.record?.scope).toEqual({ kind: "project", projectId: "project-a" });
    expect((await store.readOperationalState({ version: 1 })).version).toBe(1);
    await expect(access.write({
      root: "memory:project",
      path: "project/other.md",
      content: markdownForRecord({ ...project, id: "other", scope: { kind: "project", projectId: "project-b" } }),
    })).rejects.toThrow(/scope|path/i);
  });

  it("requires a current version when overwriting an existing memory file", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    const access = new MemoryFileAccess(store, "project-a");
    const input = markdownForRecord(record({ id: "memory_write_guard" }));

    await access.write({ root: "memory:user", path: "user/memory_write_guard.md", content: input });
    await expect(access.write({ root: "memory:user", path: "user/memory_write_guard.md", content: input, overwrite: true })).rejects.toThrow(/expectedVersion/i);
  });

  it("serializes concurrent memory edits and rejects the stale second version", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    const access = new MemoryFileAccess(store, "project-a");
    const path = "user/memory_concurrent.md";
    await access.write({
      root: "memory:user",
      path,
      content: markdownForRecord(
        record({
          id: "memory_concurrent",
          content: "original value",
          dedupeKey: "memory-concurrent-key",
        }),
      ),
    });
    const version = (await access.read({ root: "memory:user", path })).version;

    const results = await Promise.allSettled([
      access.edit({ root: "memory:user", path, oldText: "original value", newText: "first value", expectedVersion: version }),
      access.edit({ root: "memory:user", path, oldText: "original value", newText: "second value", expectedVersion: version }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps candidate/archive lifecycle rules and rejects malformed or escaping paths", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    const access = new MemoryFileAccess(store, "project-a");
    const candidate = record({ id: "candidate_1", status: "candidate", source: { trigger: "extracted" } });
    const result = await access.write({ root: "memory:candidates", path: "candidate_1.md", content: markdownForRecord(candidate) });
    expect(result.record?.status).toBe("candidate");
    await expect(access.write({ root: "memory:archive", path: "cannot.md", content: markdownForRecord(record()) })).rejects.toThrow(/read-only/i);
    await expect(access.read({ root: "memory:user", path: "../outside.md" })).rejects.toThrow(/escapes/i);
    await expect(access.write({ root: "memory:user", path: "user/bad.md", content: "not markdown" })).rejects.toThrow(/frontmatter/i);

    const outside = await tempRoot();
    await writeFile(join(outside, "secret.md"), markdownForRecord(record()), "utf8");
    await mkdir(join(root, "user"), { recursive: true });
    await symlink(outside, join(root, "user", "linked"));
    await expect(access.read({ root: "memory:user", path: "user/linked/secret.md" })).rejects.toThrow(/symlink|escape/i);
  });

  it("uses platform-neutral logical roots while resolving native paths", async () => {
    const home = "/Users/neo";
    expect(defaultMemoryRoot(home)).toBe(join(home, ".loom", "memory"));
    expect(win32.relative("C:\\Users\\neo\\.loom\\memory", "C:\\Users\\neo\\.loom\\memory\\user\\a.md")).toBe(join("user", "a.md").replaceAll("/", "\\"));
  });
});
