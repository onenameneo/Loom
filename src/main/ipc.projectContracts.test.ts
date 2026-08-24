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
    expect(mainSource).toContain("store.createNode({ sessionId: session.id, title: DEFAULT_ROOT_TITLE, titleState: \"default\" })");
  });

  it("initializes project-local files before persisting a Project", () => {
    const mainSource = readSource("src/main/index.ts");
    const initializeAt = mainSource.indexOf("initializeProjectDirectories(");
    const persistAt = mainSource.indexOf("store.createProject(input)");

    expect(initializeAt).toBeGreaterThanOrEqual(0);
    expect(persistAt).toBeGreaterThan(initializeAt);
    expect(mainSource).toContain("typeof input === \"string\" ? [] : input?.sourceRoots ?? []");
    expect(readSource("src/renderer/src/App.tsx")).not.toContain("initializeProjectDirectories");
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

  it("exposes message branching through the canvas IPC contract", () => {
    const canvasSource = readSource("src/main/canvas.ts");
    const preloadSource = readSource("src/preload/index.ts");
    const envSource = readSource("src/renderer/src/env.d.ts");

    expect(canvasSource).toContain('ipcMain.handle("node:branchFromMessage"');
    expect(canvasSource).toContain("runtime.branchFromMessage");
    expect(preloadSource).toContain('branchFromMessage:');
    expect(preloadSource).toContain('ipcRenderer.invoke("node:branchFromMessage"');
    expect(envSource).toContain("branchFromMessage");
    expect(envSource).toContain('mode: "new-session" | "canvas-node"');
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

  it("exposes permission settings and approval metadata through the main/preload boundary", () => {
    const mainSource = readSource("src/main/index.ts");
    const preloadSource = readSource("src/preload/index.ts");
    const envSource = readSource("src/renderer/src/env.d.ts");

    expect(mainSource).toContain('ipcMain.handle("settings:getPermissions"');
    expect(mainSource).toContain('ipcMain.handle("settings:setPermissions"');
    expect(preloadSource).toContain('ipcRenderer.invoke("settings:getPermissions")');
    expect(preloadSource).toContain('ipcRenderer.invoke("settings:setPermissions", patch)');
    expect(envSource).toContain("sandboxMode");
    expect(envSource).toContain("approvalPolicy");
    expect(envSource).toContain("normalizedTarget");
  });

  it("keeps generated-file actions opaque across the main/preload boundary", () => {
    const mainSource = readSource("src/main/index.ts");
    const preloadSource = readSource("src/preload/index.ts");
    const envSource = readSource("src/renderer/src/env.d.ts");

    expect(mainSource).toContain('ipcMain.handle("artifact:action"');
    expect(mainSource).toContain("parseArtifactActionRequest");
    expect(mainSource).toContain("fileArtifacts.resolve");
    expect(preloadSource).toContain('ipcRenderer.invoke("artifact:action", request)');
    expect(envSource).toContain("action: (request: FileArtifactActionRequest)");
    expect(envSource).toContain("FileArtifactRef");
  });

  it("registers a native editable context menu for Electron text controls", () => {
    const mainSource = readSource("src/main/index.ts");

    expect(mainSource).toContain("webContents.on(\"context-menu\"");
    expect(mainSource).toContain("params.isEditable");
    expect(mainSource).toContain('role: "cut"');
    expect(mainSource).toContain('role: "copy"');
    expect(mainSource).toContain('role: "paste"');
    expect(mainSource).toContain('role: "selectAll"');
    expect(mainSource).toContain("event.preventDefault()");
    expect(mainSource).toContain('inputFieldType === "plainText"');
    expect(mainSource).toContain("frame: params.frame");
  });

  it("derives the API-key warning from the selected models.json model", () => {
    const mainSource = readSource("src/main/index.ts");

    expect(mainSource).toContain("hasKey: selected.available");
    expect(mainSource).not.toContain("hasKey: Boolean(process.env.ANTHROPIC_API_KEY)");
  });
});
