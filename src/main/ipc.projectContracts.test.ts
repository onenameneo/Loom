import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readSource(path: string) {
  return readFileSync(join(repoRoot, path), "utf-8");
}

describe("main/preload project IPC contracts", () => {
  it("does not register legacy ws:* IPC handlers in the main process", () => {
    const mainSource = readSource("src/main/index.ts");

    expect(mainSource).not.toMatch(/ipcMain\.handle\(["']ws:/);
  });

  it("does not expose window.api.workspaces from preload", () => {
    const preloadSource = readSource("src/preload/index.ts");

    expect(preloadSource).not.toMatch(/\bworkspaces\s*:/);
    expect(preloadSource).not.toContain('"ws:');
  });

  it("uses project store methods for project IPC handlers", () => {
    const mainSource = readSource("src/main/index.ts");

    expect(mainSource).toContain("store.createProject");
    expect(mainSource).toContain("store.listProjects");
    expect(mainSource).toContain("store.renameProject");
    expect(mainSource).toContain("store.deleteProject");
    expect(mainSource).not.toContain("store.createWorkspace");
    expect(mainSource).not.toContain("store.listWorkspaces");
    expect(mainSource).not.toContain("store.renameWorkspace");
    expect(mainSource).not.toContain("store.deleteWorkspace");
  });
});
