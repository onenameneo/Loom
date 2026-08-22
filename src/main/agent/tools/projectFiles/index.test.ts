import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, realpathSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectFileTools, createProjectMutationTools } from ".";
import { fileVersion, MAX_MUTATION_DIFF_INPUT_BYTES, withFileMutationQueue } from "./access";
import { markdownForRecord } from "../../../memory/markdown";
import { MemoryFileAccess } from "../../../memory/fileAccess";
import { MemoryStore } from "../../../memory/storage";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectRoot() {
  const root = mkdtempSync(join(tmpdir(), "loom-project-files-"));
  dirs.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "src", "index.ts"), "zero\nneedle here\ntwo\n", "utf-8");
  writeFileSync(join(root, "src", "other.ts"), "const value = 1;\n", "utf-8");
  writeFileSync(join(root, "node_modules", "hidden.ts"), "needle\n", "utf-8");
  writeFileSync(join(root, ".git", "config"), "needle\n", "utf-8");
  return root;
}

function tool<T extends string>(root: string, name: T) {
  return createProjectFileTools([root]).find((candidate) => candidate.name === name)!;
}

function mutationTool<T extends string>(root: string, name: T) {
  return createProjectMutationTools([root]).find((candidate) => candidate.name === name)!;
}

async function readVersion(root: string, path: string): Promise<string> {
  const read = tool(root, "read");
  const result = await read.execute({ toolCallId: `version-${path}`, args: { path } });
  return (result.details as { version: string }).version;
}

function fileStatVersion(path: string): string {
  return fileVersion(statSync(path));
}

function modelVersion(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  const match = text.match(/\[File version: ([^\]]+)\]/);
  if (!match) throw new Error("Model-visible file version is missing.");
  return match[1]!;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("project coding tools", () => {
  it("are hidden when no source roots are configured", () => {
    expect(createProjectFileTools([])).toEqual([]);
  });

  it("reports missing or unconfigured roots as Project source roots", async () => {
    const root = projectRoot();
    const read = tool(root, "read");

    expect(() => createProjectMutationTools([])).not.toThrow();
    await expect(read.execute({ toolCallId: "t1", args: { root: join(root, "not-configured"), path: "src/index.ts" } })).rejects.toThrow(
      "source roots",
    );
  });

  it("reads numbered bounded lines and reports truncation", async () => {
    const root = projectRoot();
    const read = tool(root, "read");
    const result = await read.execute({ toolCallId: "t1", args: { path: "src/index.ts", offset: 2, limit: 1 } });

    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("2 | needle here") });
    const version = (result.details as { version: string }).version;
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`[File version: ${version}]`) });
    expect(result.details).toMatchObject({ path: "src/index.ts", offset: 2, returnedLines: 1, truncation: { truncated: true, reason: "lines" } });
  });

  it("caps long lines and returns an actionable continuation after the byte limit", async () => {
    const root = projectRoot();
    const read = tool(root, "read");
    const longLine = "x".repeat(2_100);
    const content = Array.from({ length: 220 }, (_, index) => `${index + 1}-${"y".repeat(300)}`).join("\n");
    writeFileSync(join(root, "src", "large.txt"), `${longLine}\n${content}\n`, "utf-8");

    const result = await read.execute({ toolCallId: "t-long", args: { path: "src/large.txt" } });
    const text = result.content[0];

    expect(text).toMatchObject({ type: "text" });
    expect((text as { type: "text"; text: string }).text).toContain("line truncated to 2000 chars");
    expect((text as { type: "text"; text: string }).text).toContain("Use offset=");
    expect(result.details).toMatchObject({
      path: "src/large.txt",
      totalLines: 221,
      truncation: { truncated: true, reason: "bytes" },
    });
  });

  it("rejects an offset beyond the end of the file", async () => {
    const root = projectRoot();
    const read = tool(root, "read");

    await expect(read.execute({ toolCallId: "t-offset", args: { path: "src/index.ts", offset: 99 } })).rejects.toThrow(
      /offset 99 is out of range/i,
    );
  });

  it("returns a file version and rejects stale writes and edits", async () => {
    const root = projectRoot();
    const read = tool(root, "read");
    const write = mutationTool(root, "write");
    const edit = mutationTool(root, "edit");
    const readResult = await read.execute({ toolCallId: "t-version-read", args: { path: "src/index.ts" } });
    const version = (readResult.details as { version: string }).version;
    writeFileSync(join(root, "src", "index.ts"), "externally changed\n", "utf-8");

    await expect(
      write.execute({
        toolCallId: "t-version-write",
        args: { path: "src/index.ts", content: "replacement\n", overwrite: true, expectedVersion: version },
      }),
    ).rejects.toThrow(/changed since it was read/i);
    await expect(
      edit.execute({
        toolCallId: "t-version-edit",
        args: { path: "src/index.ts", oldText: "externally changed", newText: "edited", expectedVersion: version },
      }),
    ).rejects.toThrow(/changed since it was read/i);
  });

  it("omits the contextual diff when the existing file exceeds the diff input cap", async () => {
    const root = projectRoot();
    const write = mutationTool(root, "write");
    const largePath = join(root, "src", "large-existing.txt");
    writeFileSync(largePath, `${"old\n".repeat(2_700_001)}`, "utf-8");
    const version = await readVersion(root, "src/large-existing.txt");

    const result = await write.execute({
      toolCallId: "t-large-write",
      args: { path: "src/large-existing.txt", content: "new\n", overwrite: true, expectedVersion: version },
    });

    expect(result.details).toMatchObject({ truncation: { truncated: true, reason: "input" } });
    expect(JSON.stringify(result.details)).toContain("diff omitted");
  });

  it("lists deterministically with entry types", async () => {
    const root = projectRoot();
    const list = tool(root, "project_list_files");
    const result = await list.execute({ toolCallId: "t1", args: { path: ".", maxEntries: 2 } });

    expect(result.content[0]).toMatchObject({ type: "text", text: "dir .git\ndir node_modules" });
    expect(result.details).toMatchObject({ path: ".", truncation: { truncated: true, reason: "entries" } });
  });

  it("rejects path traversal and escaping symbolic links", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "secret", "utf-8");
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "outside-link"));
    const read = tool(root, "read");
    const list = tool(root, "project_list_files");

    await expect(read.execute({ toolCallId: "t1", args: { path: "../outside.txt" } })).rejects.toThrow("outside this Project");
    await expect(read.execute({ toolCallId: "t2", args: { path: "src/outside-link" } })).rejects.toThrow("outside this Project");
    await expect(list.execute({ toolCallId: "t3", args: { path: "src" } })).rejects.toThrow("outside this Project");
  });

  it("reads a user-provided external absolute path only in full-access mode", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-external-read-"));
    dirs.push(outside);
    const target = join(outside, "memory.ts");
    writeFileSync(target, "export const memory = true;\n", "utf-8");

    const restricted = createProjectFileTools([root], { getSandboxMode: () => "workspace-write" })
      .find((candidate) => candidate.name === "read")!;
    await expect(restricted.execute({ toolCallId: "t-external-restricted", args: { path: target } })).rejects.toThrow("outside this Project");

    const fullAccess = createProjectFileTools([root], { getSandboxMode: () => "danger-full-access" })
      .find((candidate) => candidate.name === "read")!;
    const result = await fullAccess.execute({ toolCallId: "t-external-full", args: { path: target } });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("export const memory = true") });
    expect(result.details).toMatchObject({ path: realpathSync(target), root: "external", external: true });
  });

  it("keeps read available for an empty Project in full-access mode", async () => {
    const outside = mkdtempSync(join(tmpdir(), "loom-empty-project-external-read-"));
    dirs.push(outside);
    const target = join(outside, "README.md");
    writeFileSync(target, "external context\n", "utf-8");

    expect(createProjectFileTools([], { getSandboxMode: () => "danger-full-access" }).map((candidate) => candidate.name)).toEqual(["read"]);
    const read = createProjectFileTools([], { getSandboxMode: () => "danger-full-access" }).find((candidate) => candidate.name === "read")!;
    const result = await read.execute({ toolCallId: "t-empty-project-read", args: { path: target } });

    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("external context") });
    expect(result.details).toMatchObject({ path: realpathSync(target), root: "external" });
  });

  it("selects only an explicitly configured second root", async () => {
    const first = projectRoot();
    const second = mkdtempSync(join(tmpdir(), "loom-project-second-"));
    dirs.push(second);
    writeFileSync(join(second, "second.ts"), "export const second = true;", "utf-8");
    const find = createProjectFileTools([first, second]).find((candidate) => candidate.name === "project_find_files")!;

    const result = await find.execute({ toolCallId: "t1", args: { root: second, pattern: "*.ts" } });
    expect(result.content[0]).toMatchObject({ type: "text", text: "second.ts" });
    await expect(find.execute({ toolCallId: "t2", args: { root: join(second, "not-configured"), pattern: "*.ts" } })).rejects.toThrow("not one");
  });

  it("finds matching files while skipping git and dependencies", async () => {
    const root = projectRoot();
    const find = tool(root, "project_find_files");
    const result = await find.execute({ toolCallId: "t1", args: { pattern: "**/*.ts", limit: 1 } });

    expect(result.content[0]).toMatchObject({ type: "text", text: "src/index.ts" });
    expect(result.details).toMatchObject({ truncation: { truncated: true, reason: "results" } });
    expect(result.content[0]).not.toMatchObject({ text: expect.stringContaining("hidden.ts") });
  });

  it("greps literal text with context and glob filtering", async () => {
    const root = projectRoot();
    const grep = tool(root, "project_grep");
    const result = await grep.execute({
      toolCallId: "t1",
      args: { pattern: "needle", literal: true, glob: "**/*.ts", context: 1 },
    });

    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("src/index.ts-1: zero") });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("src/index.ts:2: needle here") });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("src/index.ts-3: two") });
  });

  it("rejects invalid regular expressions before scanning files", async () => {
    const root = projectRoot();
    const grep = tool(root, "project_grep");
    await expect(grep.execute({ toolCallId: "t1", args: { pattern: "[" } })).rejects.toThrow();
  });

  it("honors an already-aborted signal", async () => {
    const root = projectRoot();
    const controller = new AbortController();
    controller.abort();
    const find = tool(root, "project_find_files");
    await expect(find.execute({ toolCallId: "t1", args: { pattern: "**/*" }, signal: controller.signal })).rejects.toThrow("aborted");
  });

  it("creates a project file and requires explicit overwrite", async () => {
    const root = projectRoot();
    const write = mutationTool(root, "write");

    const created = await write.execute({ toolCallId: "t1", args: { path: "src/new.md", content: "hello Neo!" } });
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("hello Neo!");
    expect(created.details).toMatchObject({ path: "src/new.md", operation: "create", bytes: 10 });
    expect(JSON.stringify(created.details)).toContain("--- src/new.md");

    await expect(write.execute({ toolCallId: "t2", args: { path: "src/new.md", content: "changed" } })).rejects.toThrow("overwrite: true");
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("hello Neo!");

    const version = await readVersion(root, "src/new.md");
    const overwritten = await write.execute({ toolCallId: "t3", args: { path: "src/new.md", content: "changed", overwrite: true, expectedVersion: version } });
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("changed");
    expect(overwritten.details).toMatchObject({ operation: "overwrite" });
    expect(overwritten.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`[File version: ${(overwritten.details as { version: string }).version}]`) });
  });

  it("keeps the new file version visible for chained model edits", async () => {
    const root = projectRoot();
    const read = tool(root, "read");
    const edit = mutationTool(root, "edit");
    const firstRead = await read.execute({ toolCallId: "t-chain-read", args: { path: "src/index.ts" } });
    const first = await edit.execute({
      toolCallId: "t-chain-edit-1",
      args: { path: "src/index.ts", oldText: "zero", newText: "one", expectedVersion: modelVersion(firstRead) },
    });
    const second = await edit.execute({
      toolCallId: "t-chain-edit-2",
      args: { path: "src/index.ts", oldText: "one", newText: "two", expectedVersion: modelVersion(first) },
    });

    expect(readFileSync(join(root, "src", "index.ts"), "utf-8")).toContain("two");
    expect(second.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`[File version: ${(second.details as { version: string }).version}]`) });
  });

  it("keeps the new memory-file version visible after an edit", async () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), "loom-memory-tool-"));
    dirs.push(memoryRoot);
    const memory = new MemoryFileAccess(new MemoryStore({ rootDir: memoryRoot }), "project-a");
    const path = "project/memory_tool.md";
    await memory.write({
      root: "memory:project",
      path,
      content: markdownForRecord({
        id: "memory_tool",
        type: "project",
        scope: { kind: "project", projectId: "project-a" },
        status: "active",
        confidence: 0.9,
        description: "Memory tool contract",
        content: "Use the original contract.",
        dedupeKey: "memory-tool-version-test",
        source: { trigger: "explicit", sessionId: "s1", nodeId: "n1" },
        createdAt: 10,
        updatedAt: 10,
      }),
    });
    const read = createProjectFileTools([], { memory }).find((candidate) => candidate.name === "read")!;
    const edit = createProjectMutationTools([], { memory }).find((candidate) => candidate.name === "edit")!;
    const readResult = await read.execute({ toolCallId: "t-memory-read", args: { root: "memory:project", path } });
    const edited = await edit.execute({
      toolCallId: "t-memory-edit",
      args: { root: "memory:project", path, oldText: "original contract", newText: "updated contract", expectedVersion: modelVersion(readResult) },
    });

    expect(edited.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`[File version: ${(edited.details as { version: string }).version}]`) });
  });

  it("rejects edits that would load more than the bounded mutation input", async () => {
    const root = projectRoot();
    const path = join(root, "src", "too-large.ts");
    writeFileSync(path, `${"x".repeat(MAX_MUTATION_DIFF_INPUT_BYTES)}\n`, "utf-8");
    const edit = mutationTool(root, "edit");

    await expect(
      edit.execute({ toolCallId: "t-large-edit", args: { path: "src/too-large.ts", oldText: "x", newText: "y", expectedVersion: fileStatVersion(path) } }),
    ).rejects.toThrow(/too large|10 MB|input/i);
    expect(readFileSync(path, "utf-8")).toContain("x");
  });

  it("creates, overwrites, and edits an external file in full-access mode", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-external-write-"));
    dirs.push(outside);
    const target = join(outside, "notes.md");
    const options = { getSandboxMode: () => "danger-full-access" as const };
    const read = createProjectFileTools([root], options).find((candidate) => candidate.name === "read")!;
    const write = createProjectMutationTools([root], options).find((candidate) => candidate.name === "write")!;
    const edit = createProjectMutationTools([root], options).find((candidate) => candidate.name === "edit")!;

    expect((await write.permission!.request({ path: target, content: "hello Neo\n" })).normalizedTarget).toBe(`external:${join(realpathSync(outside), "notes.md")}`);

    const created = await write.execute({ toolCallId: "t-external-create", args: { path: target, content: "hello Neo\n" } });
    expect(created.details).toMatchObject({ path: realpathSync(target), root: "external", operation: "create" });
    expect(readFileSync(target, "utf-8")).toBe("hello Neo\n");

    const firstVersion = (await read.execute({ toolCallId: "t-external-version-1", args: { path: target } })).details as { version: string };
    const overwritten = await write.execute({
      toolCallId: "t-external-overwrite",
      args: { path: target, content: "hello Loom\n", overwrite: true, expectedVersion: firstVersion.version },
    });
    expect(overwritten.details).toMatchObject({ root: "external", operation: "overwrite" });

    const secondVersion = (await read.execute({ toolCallId: "t-external-version-2", args: { path: target } })).details as { version: string };
    const edited = await edit.execute({
      toolCallId: "t-external-edit",
      args: { path: target, oldText: "hello Loom", newText: "hello world", expectedVersion: secondVersion.version },
    });
    expect(edited.details).toMatchObject({ path: realpathSync(target), root: "external", replacements: 1 });
    expect(readFileSync(target, "utf-8")).toBe("hello world\n");

    const thirdVersion = (await read.execute({ toolCallId: "t-external-version-3", args: { path: target } })).details as { version: string };
    await write.execute({
      toolCallId: "t-external-overwrite-2",
      args: { path: target, content: "same\nsame\n", overwrite: true, expectedVersion: thirdVersion.version },
    });
    const fourthVersion = (await read.execute({ toolCallId: "t-external-version-4", args: { path: target } })).details as { version: string };
    const replacedAll = await edit.execute({
      toolCallId: "t-external-edit-all",
      args: { path: target, oldText: "same", newText: "other", replaceAll: true, expectedVersion: fourthVersion.version },
    });
    expect(replacedAll.details).toMatchObject({ root: "external", replacements: 2 });
    expect(readFileSync(target, "utf-8")).toBe("other\nother\n");

    const concurrentVersion = (await read.execute({ toolCallId: "t-external-version-5", args: { path: target } })).details as { version: string };
    const first = edit.execute({ toolCallId: "t-external-concurrent-1", args: { path: target, oldText: "other\nother", newText: "one\ntwo", expectedVersion: concurrentVersion.version } });
    const second = edit.execute({ toolCallId: "t-external-concurrent-2", args: { path: target, oldText: "other\nother", newText: "two\none", expectedVersion: concurrentVersion.version } });
    const concurrentResults = await Promise.allSettled([first, second]);
    expect(concurrentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("uses configured writable roots for external file capability targets", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-writable-root-"));
    dirs.push(outside);
    const target = join(outside, "notes.md");
    const options = { getSandboxMode: () => "workspace-write" as const, getWritableRoots: () => [outside] };
    const write = createProjectMutationTools([root], options).find((candidate) => candidate.name === "write")!;

    const request = await write.permission!.request({ path: target, content: "allowed\n" });
    expect(request.targetInWorkspace).toBe(true);
    await write.execute({ toolCallId: "t-writable-root", args: { path: target, content: "allowed\n" } });
    expect(readFileSync(target, "utf-8")).toBe("allowed\n");
  });

  it("rejects unsafe or unguarded external mutations", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-external-mutation-boundary-"));
    const other = mkdtempSync(join(tmpdir(), "loom-project-external-mutation-other-"));
    dirs.push(outside, other);
    const target = join(outside, "notes.md");
    writeFileSync(target, "original\n", "utf-8");
    symlinkSync(target, join(outside, "link.md"));
    const restrictedOptions = { getSandboxMode: () => "workspace-write" as const };
    const fullOptions = { getSandboxMode: () => "danger-full-access" as const };
    const restrictedWrite = createProjectMutationTools([root], restrictedOptions).find((candidate) => candidate.name === "write")!;
    const fullWrite = createProjectMutationTools([root], fullOptions).find((candidate) => candidate.name === "write")!;
    const fullEdit = createProjectMutationTools([root], fullOptions).find((candidate) => candidate.name === "edit")!;
    writeFileSync(join(outside, "binary.bin"), Buffer.from([0xff, 0xfe]));
    const binaryVersion = fileStatVersion(join(outside, "binary.bin"));

    await expect(restrictedWrite.execute({ toolCallId: "t-external-write-restricted", args: { path: target, content: "blocked" } })).rejects.toThrow("danger-full-access");
    await expect(fullWrite.execute({ toolCallId: "t-external-write-missing-version", args: { path: target, content: "blocked", overwrite: true } })).rejects.toThrow("expectedVersion");
    await expect(fullEdit.execute({ toolCallId: "t-external-edit-missing-version", args: { path: target, oldText: "original", newText: "changed" } })).rejects.toThrow("expectedVersion");
    await expect(fullWrite.execute({ toolCallId: "t-external-write-parent", args: { path: join(other, "missing", "new.md"), content: "blocked" } })).rejects.toThrow("Parent directory");
    await expect(fullWrite.execute({ toolCallId: "t-external-write-link", args: { path: join(outside, "link.md"), content: "blocked", overwrite: true, expectedVersion: fileStatVersion(target) } })).rejects.toThrow("symbolic link");
    await expect(fullEdit.execute({ toolCallId: "t-external-edit-binary", args: { path: join(outside, "binary.bin"), oldText: "x", newText: "y", expectedVersion: binaryVersion } })).rejects.toThrow();
    expect(readFileSync(target, "utf-8")).toBe("original\n");
  });

  it("edits a project file by exact match and supports explicit replace all", async () => {
    const root = projectRoot();
    const edit = mutationTool(root, "edit");

    const single = await edit.execute({ toolCallId: "t1", args: { path: "src/index.ts", oldText: "needle here", newText: "needle there", expectedVersion: await readVersion(root, "src/index.ts") } });
    expect(readFileSync(join(root, "src", "index.ts"), "utf-8")).toContain("needle there");
    expect(single.details).toMatchObject({ path: "src/index.ts", operation: "edit", replacements: 1 });

    writeFileSync(join(root, "src", "dupes.txt"), "same\nsame\n", "utf-8");
    await expect(
      edit.execute({ toolCallId: "t2", args: { path: "src/dupes.txt", oldText: "same", newText: "other", expectedVersion: await readVersion(root, "src/dupes.txt") } }),
    ).rejects.toThrow("matched 2 times");
    expect(readFileSync(join(root, "src", "dupes.txt"), "utf-8")).toBe("same\nsame\n");

    const all = await edit.execute({
      toolCallId: "t3",
      args: { path: "src/dupes.txt", oldText: "same", newText: "other", replaceAll: true, expectedVersion: await readVersion(root, "src/dupes.txt") },
    });
    expect(readFileSync(join(root, "src", "dupes.txt"), "utf-8")).toBe("other\nother\n");
    expect(all.details).toMatchObject({ replacements: 2 });
  });

  it("rejects mutation boundaries, missing parents, symlinks, invalid UTF-8, and missing matches", async () => {
    const root = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-project-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "secret", "utf-8");
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "outside-link"));
    writeFileSync(join(root, "src", "binary.txt"), Buffer.from([0xff, 0xfe]));
    const write = mutationTool(root, "write");
    const edit = mutationTool(root, "edit");

    await expect(write.execute({ toolCallId: "t1", args: { path: "../outside.txt", content: "x" } })).rejects.toThrow("outside this Project");
    await expect(write.execute({ toolCallId: "t2", args: { path: "missing/new.txt", content: "x" } })).rejects.toThrow();
    await expect(write.execute({ toolCallId: "t3", args: { path: "src/outside-link", content: "x", overwrite: true } })).rejects.toThrow("symbolic link");
    await expect(edit.execute({ toolCallId: "t4", args: { path: "src/index.ts", oldText: "absent", newText: "x", expectedVersion: await readVersion(root, "src/index.ts") } })).rejects.toThrow("not found");
    await expect(edit.execute({ toolCallId: "t5", args: { path: "src/binary.txt", oldText: "x", newText: "y", expectedVersion: fileStatVersion(join(root, "src", "binary.txt")) } })).rejects.toThrow();
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
  });

  it("serializes same-file mutations and allows independent file queues to progress", async () => {
    const root = projectRoot();
    const edit = mutationTool(root, "edit");

    const version = await readVersion(root, "src/index.ts");
    const first = edit.execute({ toolCallId: "t1", args: { path: "src/index.ts", oldText: "zero", newText: "one", expectedVersion: version } });
    const second = edit.execute({ toolCallId: "t2", args: { path: "src/index.ts", oldText: "zero", newText: "two", expectedVersion: version } });
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const finalContent = readFileSync(join(root, "src", "index.ts"), "utf-8");
    expect(finalContent).not.toContain("zero");
    expect(finalContent).toMatch(/one|two/);

    const gate = deferred();
    const log: string[] = [];
    const blocked = withFileMutationQueue("file-a", async () => {
      log.push("a-start");
      await gate.promise;
      log.push("a-end");
    });
    await withFileMutationQueue("file-b", async () => {
      log.push("b");
    });
    expect(log).toEqual(["a-start", "b"]);
    gate.resolve();
    await blocked;
    expect(log).toEqual(["a-start", "b", "a-end"]);
  });
});
