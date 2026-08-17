import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProjectDirectories, PROJECT_AGENTS_TEMPLATE } from "./projectDirectory";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "loom-project-directory-"));
  roots.push(root);
  return root;
}

describe("project directory initialization", () => {
  it("creates AGENTS.md and the minimal .loom structure for one source root", () => {
    const root = tempRoot();

    initializeProjectDirectories([root]);

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(PROJECT_AGENTS_TEMPLATE);
    expect(JSON.parse(readFileSync(join(root, ".loom", "settings.json"), "utf8"))).toEqual({});
    expect(statSync(join(root, ".loom", "skills")).isDirectory()).toBe(true);
    expect(readdirSync(root).sort()).toEqual([".loom", "AGENTS.md"].sort());
    expect(readdirSync(join(root, ".loom")).sort()).toEqual(["settings.json", "skills"].sort());
  });

  it("initializes every source root", () => {
    const first = tempRoot();
    const second = tempRoot();

    initializeProjectDirectories([first, second]);

    for (const root of [first, second]) {
      expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(root, ".loom", "settings.json"))).toBe(true);
      expect(existsSync(join(root, ".loom", "skills"))).toBe(true);
    }
  });

  it("does nothing when a project has no source roots", () => {
    expect(() => initializeProjectDirectories([])).not.toThrow();
  });

  it("preserves existing AGENTS.md, settings, and skills files", () => {
    const root = tempRoot();
    const loom = join(root, ".loom");
    const settings = join(loom, "settings.json");
    const skills = join(loom, "skills");
    const agents = "# User instructions\n\nKeep the existing architecture.\n";
    const settingsText = '{\n  "defaults": {"model": {"providerId": "test", "modelId": "model"}}\n}\n';
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), agents);
    writeFileSync(settings, settingsText);
    writeFileSync(join(skills, "local.md"), "user skill");

    initializeProjectDirectories([root]);

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(agents);
    expect(readFileSync(settings, "utf8")).toBe(settingsText);
    expect(readFileSync(join(skills, "local.md"), "utf8")).toBe("user skill");
  });

  it("is safe to run repeatedly", () => {
    const root = tempRoot();

    initializeProjectDirectories([root]);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    const settings = readFileSync(join(root, ".loom", "settings.json"), "utf8");
    initializeProjectDirectories([root]);

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(agents);
    expect(readFileSync(join(root, ".loom", "settings.json"), "utf8")).toBe(settings);
  });

  it("rejects a missing or non-directory source root", () => {
    const root = tempRoot();
    const file = join(root, "not-a-directory");
    writeFileSync(file, "file");

    expect(() => initializeProjectDirectories([join(root, "missing")] )).toThrow(/source root/i);
    expect(() => initializeProjectDirectories([file])).toThrow(/source root/i);
  });

  it("rejects conflicting AGENTS.md and .loom paths without overwriting them", () => {
    const agentsConflict = tempRoot();
    mkdirSync(join(agentsConflict, "AGENTS.md"));
    const loomConflict = tempRoot();
    writeFileSync(join(loomConflict, ".loom"), "not a directory");

    expect(() => initializeProjectDirectories([agentsConflict])).toThrow(/AGENTS\.md/i);
    expect(() => initializeProjectDirectories([loomConflict])).toThrow(/\.loom/i);
    expect(statSync(join(agentsConflict, "AGENTS.md")).isDirectory()).toBe(true);
    expect(readFileSync(join(loomConflict, ".loom"), "utf8")).toBe("not a directory");
  });

  it("generates a non-sensitive template", () => {
    const root = tempRoot();

    initializeProjectDirectories([root]);

    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain(".loom/settings.json");
    expect(agents).toContain(".loom/skills/");
    expect(agents).not.toMatch(/api[_ -]?key|token|password|\/Users\/|[A-Z]:\\/i);
  });
});
