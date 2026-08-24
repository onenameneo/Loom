import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileArtifactRegistry } from "./fileArtifacts";

const tempRoot = join(process.cwd(), ".tmp-file-artifacts-test");

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("FileArtifactRegistry", () => {
  it("registers project and out-of-project files with public refs that hide absolute paths", () => {
    mkdirSync(tempRoot, { recursive: true });
    const projectFile = join(tempRoot, "report.docx");
    const externalFile = join(tempRoot, "export.pdf");
    writeFileSync(projectFile, "doc");
    writeFileSync(externalFile, "pdf");
    const registry = new FileArtifactRegistry();

    const project = registry.register({
      absolutePath: projectFile,
      name: "report.docx",
      displayPath: "docs/report.docx",
      kind: "document",
      operation: "created",
      project: { projectId: "p1", root: "project:0", path: "docs/report.docx" },
    });
    const external = registry.register({
      absolutePath: externalFile,
      name: "export.pdf",
      displayPath: externalFile,
      kind: "document",
      operation: "exported",
    });

    expect(project.ref.id).toMatch(/^artifact_/);
    expect(project.ref).not.toHaveProperty("absolutePath");
    expect(external.ref.displayPath).toBe(externalFile);
    expect(registry.resolve(project.ref.id, "open").ok).toBe(true);
    const restored = registry.registerRecord(project.record);
    expect(restored.ref.id).toBe(project.ref.id);
    expect(restored.ref.displayPath).toBe(project.ref.displayPath);
  });

  it("rejects stale files and high-risk open actions", () => {
    mkdirSync(tempRoot, { recursive: true });
    const file = join(tempRoot, "script.sh");
    writeFileSync(file, "echo one");
    const registry = new FileArtifactRegistry();
    const artifact = registry.register({ absolutePath: file, name: "script.sh", displayPath: file, kind: "other", operation: "created" });
    expect(registry.resolve(artifact.ref.id, "open")).toMatchObject({ ok: false, error: "unsupported" });

    writeFileSync(file, "echo two");
    expect(registry.resolve(artifact.ref.id, "reveal")).toMatchObject({ ok: false, error: "stale" });
  });

  it("only resolves registered opaque ids and permits project preview", () => {
    mkdirSync(tempRoot, { recursive: true });
    const file = join(tempRoot, "notes.md");
    writeFileSync(file, "notes");
    const registry = new FileArtifactRegistry();
    const artifact = registry.register({ absolutePath: file, name: "notes.md", displayPath: "notes.md", kind: "text", operation: "updated", project: { projectId: "p1", root: "project:0", path: "notes.md" } });

    expect(registry.resolve("/tmp/notes.md", "open")).toMatchObject({ ok: false, error: "not-found" });
    expect(registry.resolve(artifact.ref.id, "preview")).toMatchObject({ ok: true, record: { absolutePath: file } });
    expect(readFileSync(file, "utf8")).toBe("notes");
  });

  it("canonicalizes symlinked files and reports deleted files as unavailable", () => {
    mkdirSync(tempRoot, { recursive: true });
    const file = join(tempRoot, "notes.md");
    const link = join(tempRoot, "alias.md");
    writeFileSync(file, "notes");
    symlinkSync(file, link);
    const registry = new FileArtifactRegistry();
    const artifact = registry.register({ absolutePath: link, name: "alias.md", displayPath: "alias.md", kind: "text", operation: "created" });

    expect(artifact.record.absolutePath).toBe(file);
    rmSync(file);
    expect(registry.resolve(artifact.ref.id, "reveal")).toMatchObject({ ok: false, error: "unavailable" });
  });
});
