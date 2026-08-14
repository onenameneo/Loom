import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectFileTools, createProjectMutationTools } from ".";
import { withFileMutationQueue } from "./access";

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
    const read = tool(root, "project_read_file");

    expect(() => createProjectMutationTools([])).not.toThrow();
    await expect(read.execute({ toolCallId: "t1", args: { root: join(root, "not-configured"), path: "src/index.ts" } })).rejects.toThrow(
      "source roots",
    );
  });

  it("reads numbered bounded lines and reports truncation", async () => {
    const root = projectRoot();
    const read = tool(root, "project_read_file");
    const result = await read.execute({ toolCallId: "t1", args: { path: "src/index.ts", offset: 2, limit: 1 } });

    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("2 | needle here") });
    expect(result.details).toMatchObject({ path: "src/index.ts", offset: 2, returnedLines: 1, truncation: { truncated: true, reason: "lines" } });
  });

  it("caps long lines and returns an actionable continuation after the byte limit", async () => {
    const root = projectRoot();
    const read = tool(root, "project_read_file");
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
    const read = tool(root, "project_read_file");

    await expect(read.execute({ toolCallId: "t-offset", args: { path: "src/index.ts", offset: 99 } })).rejects.toThrow(
      /offset 99 is out of range/i,
    );
  });

  it("returns a file version and rejects stale writes and edits", async () => {
    const root = projectRoot();
    const read = tool(root, "project_read_file");
    const write = mutationTool(root, "project_write_file");
    const edit = mutationTool(root, "project_edit_file");
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
    const write = mutationTool(root, "project_write_file");
    writeFileSync(join(root, "src", "large-existing.txt"), `${"old\n".repeat(2_700_001)}`, "utf-8");

    const result = await write.execute({
      toolCallId: "t-large-write",
      args: { path: "src/large-existing.txt", content: "new\n", overwrite: true },
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
    const read = tool(root, "project_read_file");
    const list = tool(root, "project_list_files");

    await expect(read.execute({ toolCallId: "t1", args: { path: "../outside.txt" } })).rejects.toThrow("outside this Project");
    await expect(read.execute({ toolCallId: "t2", args: { path: "src/outside-link" } })).rejects.toThrow("outside this Project");
    await expect(list.execute({ toolCallId: "t3", args: { path: "src" } })).rejects.toThrow("outside this Project");
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
    const write = mutationTool(root, "project_write_file");

    const created = await write.execute({ toolCallId: "t1", args: { path: "src/new.md", content: "hello Neo!" } });
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("hello Neo!");
    expect(created.details).toMatchObject({ path: "src/new.md", operation: "create", bytes: 10 });
    expect(JSON.stringify(created.details)).toContain("--- src/new.md");

    await expect(write.execute({ toolCallId: "t2", args: { path: "src/new.md", content: "changed" } })).rejects.toThrow("overwrite: true");
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("hello Neo!");

    const overwritten = await write.execute({ toolCallId: "t3", args: { path: "src/new.md", content: "changed", overwrite: true } });
    expect(readFileSync(join(root, "src", "new.md"), "utf-8")).toBe("changed");
    expect(overwritten.details).toMatchObject({ operation: "overwrite" });
  });

  it("edits a project file by exact match and supports explicit replace all", async () => {
    const root = projectRoot();
    const edit = mutationTool(root, "project_edit_file");

    const single = await edit.execute({ toolCallId: "t1", args: { path: "src/index.ts", oldText: "needle here", newText: "needle there" } });
    expect(readFileSync(join(root, "src", "index.ts"), "utf-8")).toContain("needle there");
    expect(single.details).toMatchObject({ path: "src/index.ts", operation: "edit", replacements: 1 });

    writeFileSync(join(root, "src", "dupes.txt"), "same\nsame\n", "utf-8");
    await expect(
      edit.execute({ toolCallId: "t2", args: { path: "src/dupes.txt", oldText: "same", newText: "other" } }),
    ).rejects.toThrow("matched 2 times");
    expect(readFileSync(join(root, "src", "dupes.txt"), "utf-8")).toBe("same\nsame\n");

    const all = await edit.execute({
      toolCallId: "t3",
      args: { path: "src/dupes.txt", oldText: "same", newText: "other", replaceAll: true },
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
    const write = mutationTool(root, "project_write_file");
    const edit = mutationTool(root, "project_edit_file");

    await expect(write.execute({ toolCallId: "t1", args: { path: "../outside.txt", content: "x" } })).rejects.toThrow("outside this Project");
    await expect(write.execute({ toolCallId: "t2", args: { path: "missing/new.txt", content: "x" } })).rejects.toThrow();
    await expect(write.execute({ toolCallId: "t3", args: { path: "src/outside-link", content: "x", overwrite: true } })).rejects.toThrow("symbolic link");
    await expect(edit.execute({ toolCallId: "t4", args: { path: "src/index.ts", oldText: "absent", newText: "x" } })).rejects.toThrow("not found");
    await expect(edit.execute({ toolCallId: "t5", args: { path: "src/binary.txt", oldText: "x", newText: "y" } })).rejects.toThrow();
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
  });

  it("serializes same-file mutations and allows independent file queues to progress", async () => {
    const root = projectRoot();
    const edit = mutationTool(root, "project_edit_file");

    const first = edit.execute({ toolCallId: "t1", args: { path: "src/index.ts", oldText: "zero", newText: "one" } });
    const second = edit.execute({ toolCallId: "t2", args: { path: "src/index.ts", oldText: "zero", newText: "two" } });
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
