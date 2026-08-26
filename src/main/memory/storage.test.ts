import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownForRecord } from "./markdown";
import { MemoryStore } from "./storage";
import type { MemoryRecord } from "./types";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "loom-memory-"));
}

function activeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_manual",
    type: "user",
    scope: { kind: "user" },
    status: "active",
    confidence: 0.9,
    description: "User prefers concise answers",
    content: "Use concise answers unless the user asks for depth.",
    source: { trigger: "manual" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("MemoryStore", () => {
  it("initializes a Markdown memory root and persists explicit memories", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const record = await store.remember({
      type: "user",
      scope: { kind: "user" },
      description: "Answer style",
      content: "Prefer concise answers.",
      source: { trigger: "explicit", sessionId: "session-1" },
    });

    expect(record.id).toMatch(/^mem_/);
    expect(record.path).toContain("user");
    const scan = await store.scan();
    expect(scan.issues).toEqual([]);
    expect(scan.records[0]).toMatchObject({ type: "user", status: "active", content: "Prefer concise answers." });
    expect((await store.stats()).active).toBe(1);
  });

  it("isolates project records while retaining user-global records", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    await store.remember({ type: "user", scope: { kind: "user" }, description: "Global", content: "Global", source: { trigger: "manual" } });
    await store.remember({ type: "project", scope: { kind: "project", projectId: "a" }, description: "A", content: "A", source: { trigger: "manual" } });
    await store.remember({ type: "project", scope: { kind: "project", projectId: "b" }, description: "B", content: "B", source: { trigger: "manual" } });

    const projectA = await store.listRecords({ projectId: "a" });
    expect(projectA.records.map((item) => item.description)).toEqual(expect.arrayContaining(["Global", "A"]));
    expect(projectA.records.some((item) => item.description === "B")).toBe(false);
  });

  it("keeps candidates out of active records until approval", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const candidate = await store.createCandidate({
      type: "feedback",
      scope: { kind: "user" },
      description: "Correction",
      content: "Use Chinese when the user writes Chinese.",
      source: { trigger: "extracted", sessionId: "session-1" },
    });
    expect(candidate?.status).toBe("candidate");
    expect((await store.stats()).candidates).toBe(1);
    const approved = await store.approveCandidate(candidate!.id);
    expect(approved?.status).toBe("active");
    expect((await store.stats()).candidates).toBe(0);
    expect((await store.stats()).active).toBe(1);
  });

  it("archives instead of deleting forgotten content", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const record = await store.remember({ type: "reference", scope: { kind: "user" }, description: "Reference", content: "Keep provenance.", source: { trigger: "manual" } });
    const archived = await store.forget(record.id, "obsolete");
    expect(archived).toMatchObject({ status: "archived", archivedReason: "obsolete" });
    expect((await store.stats()).active).toBe(0);
    expect((await store.stats()).archived).toBe(1);
  });

  it("restores archived memories and permanently purges them when requested", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const record = await store.remember({ type: "reference", scope: { kind: "user" }, description: "Reference", content: "Keep provenance.", source: { trigger: "manual" } });
    await store.archive(record.id, "obsolete");

    const edited = await store.edit(record.id, { content: "Keep provenance and its source." });
    expect(edited).toMatchObject({ id: record.id, status: "archived", content: "Keep provenance and its source." });

    const restored = await store.restore(record.id);
    expect(restored).toMatchObject({ id: record.id, status: "active" });

    await store.archive(record.id, "obsolete again");
    const purged = await store.purge(record.id);
    expect(purged).toMatchObject({ id: record.id, status: "archived" });
    expect((await store.scan()).records.some((item) => item.id === record.id)).toBe(false);
  });

  it("restores rejected candidates to the candidate queue", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const candidate = await store.createCandidate({
      type: "feedback",
      scope: { kind: "user" },
      description: "Correction",
      content: "Use Chinese when the user writes Chinese.",
      source: { trigger: "extracted", sessionId: "session-1" },
    });
    await store.rejectCandidate(candidate!.id, "not sure");

    const restored = await store.restore(candidate!.id);
    expect(restored).toMatchObject({ id: candidate!.id, status: "candidate" });
  });

  it("updates an existing explicit memory instead of duplicating it", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root, now: () => 10 });
    const first = await store.remember({ type: "user", scope: { kind: "user" }, description: "Style", content: "Concise", source: { trigger: "explicit" } });
    const second = await store.remember({ type: "user", scope: { kind: "user" }, description: "Style", content: "Concise", source: { trigger: "explicit" } });
    expect(second.id).toBe(first.id);
    expect((await store.scan()).records.filter((item) => item.status === "active")).toHaveLength(1);
    const edited = await store.edit(first.id, { content: "Concise unless depth is requested." });
    expect(edited?.content).toContain("depth");
  });

  it("skips malformed Markdown and rejects traversal", async () => {
    const root = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    await store.initialize();
    await writeFile(join(root, "user", "broken.md"), "# not frontmatter\n", "utf8");
    const scan = await store.scan();
    expect(scan.issues).toHaveLength(1);
    await expect(store.remember({
      id: "../escape",
      type: "user",
      scope: { kind: "user" },
      description: "bad",
      content: "bad",
      source: { trigger: "manual" },
    })).rejects.toThrow(/escapes|path/i);
  });

  it("rejects symlink escapes when reading memory files", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const store = new MemoryStore({ rootDir: root });
    await store.initialize();
    await writeFile(join(outside, "outside.md"), markdownForRecord(activeRecord({ path: undefined })), "utf8");
    await mkdir(join(root, "user"), { recursive: true });
    await symlink(join(outside, "outside.md"), join(root, "user", "link.md"));
    const scan = await store.scan();
    expect(scan.records).toHaveLength(0);
    expect(scan.issues[0]?.message).toMatch(/symlink|escape/i);
  });
});
