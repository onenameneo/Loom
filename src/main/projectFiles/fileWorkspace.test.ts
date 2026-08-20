import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FILE_PREVIEW_MAX_BYTES } from "../../common/filePreview";
import type { Project, Store } from "../store/store";
import { ProjectFileWorkspace } from "./fileWorkspace";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function projectRoot(): { root: string; project: Project } {
  const root = mkdtempSync(join(tmpdir(), "loom-file-workspace-"));
  directories.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "App.tsx"), "export default function App() { return null; }\n", "utf8");
  writeFileSync(join(root, "image.png"), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  const project: Project = { id: "project-1", name: "Test", createdAt: 0, updatedAt: 0, pinned: false, order: 0, sourceRoots: [root] };
  return { root, project };
}

function service(project: Project): ProjectFileWorkspace {
  return new ProjectFileWorkspace({ listProjects: () => [project] } as Store);
}

describe("ProjectFileWorkspace", () => {
  it("lists deterministic bounded entries inside a configured root", async () => {
    const { project } = projectRoot();
    const result = await service(project).list({ projectId: project.id, root: "project:0", path: "." });

    expect(result.entries.map((entry) => entry.name)).toEqual(["src", "binary.bin", "image.png"]);
    expect(result.entries.every((entry) => !entry.path.startsWith("/"))).toBe(true);
  });

  it("previews text, image, and binary files with metadata", async () => {
    const { project } = projectRoot();
    const workspace = service(project);
    await expect(workspace.preview({ projectId: project.id, root: "project:0", path: "src/App.tsx" })).resolves.toMatchObject({
      kind: "text",
      path: "src/App.tsx",
      language: "typescript",
      version: expect.any(String),
    });
    await expect(workspace.preview({ projectId: project.id, root: "project:0", path: "image.png" })).resolves.toMatchObject({ kind: "image", mimeType: "image/png" });
    await expect(workspace.preview({ projectId: project.id, root: "project:0", path: "binary.bin" })).resolves.toMatchObject({ kind: "unsupported", reason: "binary" });
  });

  it("searches file names recursively while staying inside the project root", async () => {
    const { project } = projectRoot();
    await expect(service(project).search({ projectId: project.id, root: "project:0", query: "app" })).resolves.toMatchObject({
      entries: [{ name: "App.tsx", path: "src/App.tsx", kind: "file" }],
      truncated: false,
    });
  });

  it("rejects traversal and escaping symlinks", async () => {
    const { root, project } = projectRoot();
    const outside = mkdtempSync(join(tmpdir(), "loom-file-workspace-outside-"));
    directories.push(outside);
    writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "escape.txt"));
    const workspace = service(project);

    await expect(workspace.preview({ projectId: project.id, root: "project:0", path: "../secret.txt" })).rejects.toThrow(/outside this Project/i);
    await expect(workspace.preview({ projectId: project.id, root: "project:0", path: "src/escape.txt" })).rejects.toThrow(/outside this Project/i);
    const listed = await workspace.list({ projectId: project.id, root: "project:0", path: "src" });
    expect(listed.entries.map((entry) => entry.name)).not.toContain("escape.txt");
  });

  it("bounds large text previews", async () => {
    const { root, project } = projectRoot();
    writeFileSync(join(root, "large.txt"), "x".repeat(FILE_PREVIEW_MAX_BYTES + 10), "utf8");
    await expect(service(project).preview({ projectId: project.id, root: "project:0", path: "large.txt" })).resolves.toMatchObject({
      kind: "text",
      truncated: true,
      content: expect.any(String),
    });
  });
});
