import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectFileCandidates, resolveProjectFileMentions } from "./fileMentions";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "loom-file-mentions-"));
  dirs.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "README.md"), "# Loom\n", "utf-8");
  writeFileSync(join(root, "src", "index.ts"), "export const loom = true;\n", "utf-8");
  writeFileSync(join(root, "node_modules", "hidden.ts"), "hidden\n", "utf-8");
  return root;
}

describe("project file mentions", () => {
  it("returns deterministic bounded candidates and skips dependency directories", async () => {
    const root = project();
    const candidates = await findProjectFileCandidates([root], "", 20);

    expect(candidates.map((candidate) => candidate.path)).toEqual(["README.md", "src/index.ts"]);
    expect(candidates.every((candidate) => candidate.root === "project:0")).toBe(true);
    await expect(findProjectFileCandidates([root], "", 1)).resolves.toHaveLength(1);
  });

  it("omits hidden entries and paths ignored by the project gitignore", async () => {
    const root = project();
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, ".cache"));
    writeFileSync(join(root, ".gitignore"), "dist/\n*.secret\n", "utf-8");
    writeFileSync(join(root, "dist", "bundle.js"), "ignored\n", "utf-8");
    writeFileSync(join(root, ".cache", "state.json"), "hidden\n", "utf-8");
    writeFileSync(join(root, ".env"), "SECRET=true\n", "utf-8");
    writeFileSync(join(root, "credentials.secret"), "secret\n", "utf-8");

    const candidates = await findProjectFileCandidates([root], "", 20);

    expect(candidates.map((candidate) => candidate.path)).toEqual(["README.md", "src/index.ts"]);
  });

  it("searches within the current project paths when the @ query includes a directory", async () => {
    const root = project();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "index.ts"), "docs\n", "utf-8");

    const candidates = await findProjectFileCandidates([root], "src/");

    expect(candidates.map((candidate) => candidate.path)).toEqual(["src/index.ts"]);
  });

  it("resolves text files but reports binary, missing, and escaping mentions individually", async () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), "loom-file-mentions-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "secret\n", "utf-8");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "escape.txt"));

    const result = await resolveProjectFileMentions(
      [root],
      [
        { root: "project:0", path: "src/index.ts" },
        { root: "project:0", path: "binary.bin" },
        { root: "project:0", path: "missing.ts" },
        { root: "project:0", path: "src/escape.txt" },
      ],
    );

    expect(result.files).toEqual([
      expect.objectContaining({ root: "project:0", path: "src/index.ts", content: expect.stringContaining("loom") }),
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "binary.bin", code: "binary" }),
        expect.objectContaining({ path: "missing.ts", code: "not-found" }),
        expect.objectContaining({ path: "src/escape.txt", code: "outside-root" }),
      ]),
    );
    expect(result.metadata).toMatchObject({ requested: 4, resolved: 1, rejected: 3 });
  });

  it("enforces the total context budget across otherwise valid files", async () => {
    const root = project();
    writeFileSync(join(root, "large-a.txt"), "a".repeat(45 * 1024), "utf-8");
    writeFileSync(join(root, "large-b.txt"), "b".repeat(45 * 1024), "utf-8");
    writeFileSync(join(root, "large-c.txt"), "c".repeat(45 * 1024), "utf-8");
    writeFileSync(join(root, "large-d.txt"), "d".repeat(45 * 1024), "utf-8");

    const result = await resolveProjectFileMentions([root], [
      { root: "project:0", path: "large-a.txt" },
      { root: "project:0", path: "large-b.txt" },
      { root: "project:0", path: "large-c.txt" },
      { root: "project:0", path: "large-d.txt" },
    ]);

    expect(result.files).toHaveLength(3);
    expect(result.errors).toEqual([expect.objectContaining({ path: "large-d.txt", code: "too-large" })]);
    expect(result.metadata.totalBytes).toBeLessThanOrEqual(160 * 1024);
  });
});
