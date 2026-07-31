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

  it("creates one default Session and root Node when creating a Project", () => {
    const mainSource = readSource("src/main/index.ts");

    expect(mainSource).toMatch(/const session = store\.ensureDefaultSession\(project\.id\)/);
    expect(mainSource).toContain('store.createNode({ sessionId: session.id, title: "主线", mountAncestors: false })');
  });

  it("exposes context compaction IPC through main, preload, and renderer contracts", () => {
    const canvasSource = readSource("src/main/canvas.ts");
    const preloadSource = readSource("src/preload/index.ts");
    const envSource = readSource("src/renderer/src/env.d.ts");

    expect(canvasSource).toContain('ipcMain.handle("node:compact"');
    expect(canvasSource).toContain("createRuntimeSummarizer");
    expect(canvasSource).toContain("compaction: {");
    expect(canvasSource).toContain("summarize: (input, options) => summarizer.summarize(input, options)");
    expect(canvasSource).toContain("maxTokens: options.maxOutputTokens");
    expect(preloadSource).toContain('compact: (nodeId: string)');
    expect(preloadSource).toContain('ipcRenderer.invoke("node:compact", nodeId)');
    expect(envSource).toContain('type: "compaction"');
    expect(envSource).toContain("CompactionCanvasEventPayload");
  });

  it("routes main-to-renderer pushes through the renderer lifecycle gate", () => {
    const mainSource = readSource("src/main/index.ts");
    const safeSendSource = readSource("src/main/ipcSafeSend.ts");
    const preloadSource = readSource("src/preload/index.ts");
    const rendererSource = readSource("src/renderer/src/main.tsx");
    const mainFiles = [
      "src/main/index.ts",
      "src/main/monitor.ts",
      "src/main/canvas.ts",
      "src/main/collector.ts",
      "src/main/acp.ts",
      "src/main/agent/adapters/ipcEventSink.ts",
    ].map(readSource);

    expect(mainSource).toContain('ipcMain.on("renderer:ready"');
    expect(mainSource).toContain("markRendererNotReady");
    expect(safeSendSource).toContain("readyContents");
    expect(safeSendSource).toContain("webContents.mainFrame");
    expect(preloadSource).toContain('ready: () => ipcRenderer.send("renderer:ready")');
    expect(rendererSource).toContain("window.api?.lifecycle.ready()");
    for (const source of mainFiles) expect(source).not.toMatch(/webContents\.send\(/);
  });
});
