import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./jsonStore";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("JsonStore canonical project contract", () => {
  it("normalizes loaded projects to sourceRoots", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-json-project-"));
    dirs.push(dir);
    const file = join(dir, "canvas-data.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        settings: {},
        projects: [{ id: "project-1", name: "Project", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }],
        sessions: [],
      }),
      "utf-8",
    );

    const store = new JsonStore(file);

    expect(store.listProjects()).toEqual([
      { id: "project-1", name: "Project", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [] },
    ]);
  });

  it("deletes sessions for a deleted project", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-json-cascade-"));
    dirs.push(dir);
    const store = new JsonStore(join(dir, "canvas-data.json"));
    const first = store.createProject("First");
    const second = store.createProject("Second");
    const firstSession = store.createSession(first.id, "First session");
    const secondSession = store.createSession(second.id, "Second session");

    store.deleteProject(first.id);

    expect(store.listSessions(first.id)).toEqual([]);
    expect(store.listSessions(second.id).map((session) => session.id)).toEqual([secondSession.id]);
    expect(store.getSession(firstSession.id)).toBeUndefined();
  });
});
