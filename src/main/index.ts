import "dotenv/config"; // 先加载 .env（ANTHROPIC_API_KEY / BASE_URL）
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dbPath, SqliteStore } from "./store/sqliteStore";
import type { Store } from "./store/store";
import { registerCanvas } from "./canvas";
import { registerMonitor } from "./monitor";
import { registerAcp } from "./acp";
import { registerCollector } from "./collector";
import {
  accessSources,
  keyStorageKind,
  resolveModelConfig,
  saveApiKey,
} from "./settings";
import { addProviderModelConfig, deleteProviderModelConfig, ensureLoomAgentDefaults, writeGlobalDefaultModel } from "./modelConfig/files";
import { modelsJsonPath } from "./modelConfig/paths";
import { ModelRegistry } from "./modelConfig/registry";
import { loadScopedModelSettings, resolveSelectedModel } from "./modelConfig/scopes";
import { platformWindowOptions } from "./windowOptions";
import { addGlobalSkillSource, buildSkillCatalog, openSkillSource, removeGlobalSkillSource } from "./agent/skills";
import { markRendererNotReady, markRendererReady, sendToWindow } from "./ipcSafeSend";
import { DEFAULT_ROOT_TITLE, DEFAULT_SESSION_TITLE } from "../common/titleDefaults";
import { developmentIconPath, PRODUCT_NAME } from "./appBranding";
import { createMemoryRuntime, type MemoryRuntimeService } from "./memory/runtime";
import { createRuntimeMemoryExtractor } from "./memory/llmExtractor";
import type { MemoryWriteInput } from "./memory/types";
import { initializeProjectDirectories } from "./projectDirectory";
import { parseFileSearchRequest, parseFileWorkspaceRequest } from "../common/filePreview";
import { ProjectFileWorkspace } from "./projectFiles/fileWorkspace";
import { assertRendererSender } from "./fileIpcAuthorization";
import { registerMcpIpc } from "./mcp/ipc";

// ---------------------------------------------------------------------------
// 主进程：持久化(store) + 设置 + 会话 + 画布引擎(pi 多节点)。
// 模型配置走「设置优先、env 回退」(resolveModelConfig)。对话/分支画布逻辑在
// canvas.ts（每节点一个 pi Agent + 自定义 convertToLlm 分支上下文装配）。
// ---------------------------------------------------------------------------

let win: BrowserWindow | null = null;
let store: Store;
let canvas: ReturnType<typeof registerCanvas> | null = null;
let monitor: ReturnType<typeof registerMonitor> | null = null;
let acp: ReturnType<typeof registerAcp> | null = null;
let collector: ReturnType<typeof registerCollector> | null = null;
let memory: MemoryRuntimeService | null = null;
let menuLocale: "zh-CN" | "en" = app.getLocale().toLowerCase().startsWith("en") ? "en" : "zh-CN";
let mcpIpcDispose: (() => void) | undefined;

// productName 只在 electron-builder 打包时写入 Info.plist；开发态 Electron
// 二进制没有 Info.plist，app.getName() 默认返回 "Electron"，必须显式覆盖。
app.setName(PRODUCT_NAME);
const developmentIcon = developmentIconPath(process.cwd(), app.isPackaged);

function resolvedTheme(): "light" | "dark" {
  const t = store.getSettings().appearance.theme;
  if (t === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return t;
}

// 让 macOS 原生 vibrancy 材质跟随 app 主题：否则暗色 UI 会叠在亮色毛玻璃上，
// 半透明侧栏透出中间调，文字对比度骤降（表现为「深色模式字体发灰读不清」）。
function applyThemeSource() {
  nativeTheme.themeSource = store.getSettings().appearance.theme;
}

function invalidateAgent() {
  canvas?.invalidate(); // 设置变了 → 丢弃所有节点 Agent，下次发送按新配置重建
}

function registerIpc() {
  const fileWorkspace = new ProjectFileWorkspace(store);
  ipcMain.on("renderer:ready", (event) => {
    const current = win;
    if (!current || current.isDestroyed() || event.sender !== current.webContents) return;
    if (markRendererReady(current)) sendToWindow(() => current, "window:fullscreen", current.isFullScreen());
  });

  // ---- settings ----
  ipcMain.on("settings:locale", (_event, locale: unknown) => {
    menuLocale = locale === "en" ? "en" : "zh-CN";
    invalidateAgent();
    buildMenu();
  });
  ipcMain.handle("settings:get", async () => {
    const s = store.getSettings();
    const registry = await ModelRegistry.load();
    const scoped = loadScopedModelSettings({ homeDir: app.getPath("home") });
    const selected = resolveSelectedModel({ registry, scoped });
    return {
      access: s.access,
      appearance: s.appearance,
      monitor: s.monitor,
      skills: s.skills,
      permissions: s.permissions,
      memory: s.memory,
      modelRegistry: registry.toRendererDTO(),
      globalDefaultModel: scoped.globalSettings.defaults?.model,
      // 左上角模型名必须与实际运行模型一致：buildModel 走 resolveSelectedModel
      //（解析 models.json 全局默认），故此处复用同一解析，不再取 resolveModelConfig/env。
      resolvedModel: selected.model ? `${selected.ref.providerId}/${selected.ref.modelId}` : resolveModelConfig(store).model,
      sources: accessSources(store),
      hasKey: selected.available,
      legacyKeyPresent: Boolean(store.getApiKeyEnc()),
      keyStorage: keyStorageKind(),
      resolvedTheme: resolvedTheme(),
    };
  });
  ipcMain.handle("settings:set", (_e, patch) => {
    store.patchSettings(patch ?? {});
    applyThemeSource();
    invalidateAgent();
    if (store.getSettings().memory.enabled) void memory?.initialize();
    return { ok: true, appearance: store.getSettings().appearance, permissions: store.getSettings().permissions };
  });
  ipcMain.handle("settings:getPermissions", () => store.getSettings().permissions);
  ipcMain.handle("settings:setPermissions", (_e, patch) => {
    const next = store.patchSettings({ permissions: patch ?? {} });
    invalidateAgent();
    return { ok: true, permissions: next.permissions };
  });
  ipcMain.handle("settings:setKey", (_e, plain: string) => {
    const r = saveApiKey(store, plain ?? "");
    invalidateAgent();
    return { ok: true, encrypted: r.encrypted };
  });
  ipcMain.handle("settings:openModelsJson", async () => {
    const result = ensureLoomAgentDefaults({ homeDir: app.getPath("home"), legacyApiKeyPresent: Boolean(store.getApiKeyEnc()) });
    const filePath = modelsJsonPath(app.getPath("home"));
    if (!existsSync(filePath)) writeFileSync(filePath, '{\n  "providers": {}\n}\n', "utf-8");
    const error = await shell.openPath(filePath);
    return { ok: !error, path: filePath, error: error || undefined, diagnostics: result.diagnostics };
  });
  ipcMain.handle("settings:setGlobalModel", (_e, model: { providerId: string; modelId: string }) => {
    writeGlobalDefaultModel(app.getPath("home"), model);
    invalidateAgent();
    return { ok: true };
  });
  ipcMain.handle("settings:addProviderModel", (_e, input) => {
    addProviderModelConfig(app.getPath("home"), input);
    invalidateAgent();
    return { ok: true };
  });
  ipcMain.handle("settings:deleteProviderModel", (_e, model: { providerId: string; modelId: string }) => {
    deleteProviderModelConfig(app.getPath("home"), model);
    invalidateAgent();
    return { ok: true };
  });
  ipcMain.handle("settings:skills", () => {
    return buildSkillCatalog({
      settings: store.getSettings(),
      projects: store.listProjects(),
      allProjects: true,
      homeDir: app.getPath("home"),
    });
  });
  ipcMain.handle("settings:addSkillSource", (_e, path: string) => {
    const result = addGlobalSkillSource(store, path);
    invalidateAgent();
    return result;
  });
  ipcMain.handle("settings:removeSkillSource", (_e, path: string) => {
    const result = removeGlobalSkillSource(store, path);
    invalidateAgent();
    return result;
  });
  ipcMain.handle("settings:openSkillSource", async (_e, path: string) => openSkillSource(path));
  mcpIpcDispose = canvas
      ? registerMcpIpc({
        getWin: () => win,
        manager: canvas.mcp.manager,
        provider: canvas.mcp.provider,
        homeDir: app.getPath("home"),
      })
    : undefined;

  // ---- projects / sessions ----
  const createProject = (input?: string | { name?: string; sourceRoots?: string[] }) => {
    initializeProjectDirectories(typeof input === "string" ? [] : input?.sourceRoots ?? []);
    const project = store.createProject(input);
    const session = store.ensureDefaultSession(project.id);
    store.createNode({ sessionId: session.id, title: DEFAULT_ROOT_TITLE, titleState: "default" });
    void memory?.recordSession();
    return project;
  };
  ipcMain.handle("project:list", () => store.listProjects());
  ipcMain.handle("project:create", (_e, input?: string | { name?: string; sourceRoots?: string[] }) => createProject(input));
  ipcMain.handle("project:rename", (_e, { id, name }) => {
    store.renameProject(id, name);
    return { ok: true };
  });
  ipcMain.handle("project:delete", (_e, id: string) => {
    canvas?.disposeProject(id);
    store.deleteProject(id);
    return { ok: true };
  });
  ipcMain.handle("project:pin", (_e, { id, pinned }) => {
    store.setPinned(id, pinned);
    return { ok: true };
  });
  ipcMain.handle("project:updateUi", (_e, { id, ui }) => {
    store.updateProjectUi?.(id, ui);
    return { ok: true };
  });
  ipcMain.handle("project:pickSourceRoot", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "选择项目文件夹",
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, path: result.filePaths[0] };
  });
  ipcMain.handle("file:list", (event, request: unknown) => {
    assertRendererSender(event, win);
    return fileWorkspace.list(parseFileWorkspaceRequest(request));
  });
  ipcMain.handle("file:search", (event, request: unknown) => {
    assertRendererSender(event, win);
    return fileWorkspace.search(parseFileSearchRequest(request));
  });
  ipcMain.handle("file:preview", (event, request: unknown) => {
    assertRendererSender(event, win);
    return fileWorkspace.preview(parseFileWorkspaceRequest(request));
  });
  ipcMain.handle("file:open", async (event, request: unknown) => {
    assertRendererSender(event, win);
    const filePath = await fileWorkspace.absoluteFilePath(parseFileWorkspaceRequest(request));
    const error = await shell.openPath(filePath);
    return { ok: !error, error: error || undefined };
  });
  ipcMain.handle("session:list", (_e, projectId: string) => {
    return store.listSessions(projectId);
  });
  ipcMain.handle("session:create", (_e, { projectId, title }: { projectId: string; title?: string }) => {
    const session = store.createSession(projectId, title ?? DEFAULT_SESSION_TITLE, { titleState: title ? "manual" : "default" });
    store.createNode({ sessionId: session.id, title: DEFAULT_ROOT_TITLE, titleState: "default" });
    void memory?.recordSession();
    return session;
  });
  ipcMain.handle("session:rename", (_e, { id, title }: { id: string; title: string }) => {
    store.renameSession(id, title, { titleState: "manual" });
    return { ok: true };
  });
  ipcMain.handle("session:delete", (_e, id: string) => {
    const session = store.getSession(id);
    if (!session) return { ok: false };
    canvas?.disposeSession(id);
    store.deleteSession(id);
    return { ok: true };
  });
  ipcMain.handle("session:updateUi", (_e, { id, ui }: { id: string; ui: { activeNodeId?: string; mode?: "chat" | "canvas" } }) => {
    store.updateSessionUi?.(id, ui);
    return { ok: true };
  });

  // ---- cross-session long-term memory ------------------------------------
  const assertMemoryProjectScope = (scope: MemoryWriteInput["scope"] | undefined) => {
    if (scope?.kind === "project" && !store.listProjects().some((project) => project.id === scope.projectId)) {
      throw new Error("记忆所属项目不存在。");
    }
  };
  ipcMain.handle("memory:list", async (_e, arg: { projectId?: string; includeArchived?: boolean } = {}) => {
    if (!memory) return { records: [], issues: [], stats: await Promise.resolve({ active: 0, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 }) };
    const scan = await memory.list(arg.projectId, arg.includeArchived);
    return { ...scan, stats: await memory.stats() };
  });
  ipcMain.handle("memory:stats", () => memory?.stats() ?? { active: 0, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 });
  ipcMain.handle("memory:preview", (_e, id: string) => memory?.preview(id));
  ipcMain.handle("memory:remember", (_e, input: MemoryWriteInput) => {
    assertMemoryProjectScope(input?.scope);
    return memory?.remember(input);
  });
  ipcMain.handle("memory:edit", (_e, arg: { id: string; patch: Partial<MemoryWriteInput> }) => {
    assertMemoryProjectScope(arg?.patch?.scope);
    return memory?.edit(arg.id, arg.patch);
  });
  ipcMain.handle("memory:archive", (_e, arg: { id: string; reason?: string }) => memory?.archive(arg.id, arg.reason));
  ipcMain.handle("memory:forget", (_e, arg: { id: string; reason?: string }) => memory?.forget(arg.id, arg.reason));
  ipcMain.handle("memory:approve", (_e, arg: { id: string; overrides?: Parameters<MemoryRuntimeService["approveCandidate"]>[1] }) => {
    assertMemoryProjectScope(arg?.overrides?.scope);
    return memory?.approveCandidate(arg.id, arg.overrides);
  });
  ipcMain.handle("memory:reject", (_e, arg: { id: string; reason?: string }) => memory?.rejectCandidate(arg.id, arg.reason));
  ipcMain.handle("memory:autodreamStatus", () => memory?.autoDreamStatus());
  ipcMain.handle("memory:autodreamRun", () => memory?.maybeRunAutoDream());
  ipcMain.handle("memory:autodreamCancel", () => {
    memory?.cancelAutoDream();
    return { ok: true };
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const en = menuLocale === "en";
  const menuAction = (name: string) => () => sendToWindow(() => win, "menu:action", name);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: en ? "File" : "文件",
      submenu: [
        { label: en ? "New project" : "新建项目", accelerator: "CmdOrCtrl+Shift+N", click: menuAction("new-project") },
        { label: en ? "New session" : "新建会话", accelerator: "CmdOrCtrl+N", click: menuAction("new-session") },
        { type: "separator" as const },
        { label: en ? "Settings…" : "设置…", accelerator: "CmdOrCtrl+,", click: menuAction("settings") },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" as const },
    {
      label: en ? "View" : "视图",
      submenu: [
        { label: en ? "Toggle sidebar" : "切换侧栏", accelerator: "CmdOrCtrl+\\", click: menuAction("toggle-sidebar") },
        { type: "separator" as const },
        { label: en ? "Project" : "项目", accelerator: "CmdOrCtrl+1", click: menuAction("surface:project") },
        { label: en ? "Observatory" : "工作站", accelerator: "CmdOrCtrl+2", click: menuAction("surface:observatory") },
        { label: en ? "Memory" : "记忆", accelerator: "CmdOrCtrl+3", click: menuAction("surface:memory") },
        { type: "separator" as const },
        { role: "toggleDevTools" as const },
        { role: "resetZoom" as const },
      ],
    },
    { role: "windowMenu" as const },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    title: PRODUCT_NAME,
    icon: developmentIcon,
    width: 1160,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    show: false,
    ...platformWindowOptions(process.platform, resolvedTheme() === "dark"),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  });
  const windowRef = win;
  markRendererNotReady(windowRef);
  const editableContextMenu = Menu.buildFromTemplate([
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ]);
  windowRef.webContents.on("context-menu", (event, params) => {
    const inputFieldType = (params as typeof params & { inputFieldType?: string }).inputFieldType;
    const isTextEditor = params.isEditable || inputFieldType === "plainText" || inputFieldType === "password";
    if (!isTextEditor) return;
    event.preventDefault();
    editableContextMenu.popup({ window: windowRef, frame: params.frame ?? undefined });
  });
  if (store && !monitor) monitor = registerMonitor({ getWin: () => win, store });
  if (store && !acp) acp = registerAcp({ getWin: () => win, store });
  if (store && !collector) collector = registerCollector({ getWin: () => win, store });
  win.on("ready-to-show", () => win?.show());
  // 阻止 HTML <title> 覆盖 BrowserWindow title，保持标题栏始终为产品名。
  win.on("page-title-updated", (e) => e.preventDefault());
  // 全屏时 macOS 隐藏红绿灯，渲染层据此把侧栏开关移到左缘、收掉预留内边距。
  const emitFullScreen = () => sendToWindow(() => windowRef, "window:fullscreen", windowRef.isFullScreen());
  win.on("enter-full-screen", emitFullScreen);
  win.on("leave-full-screen", emitFullScreen);
  win.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) markRendererNotReady(windowRef);
  });
  win.webContents.on("render-process-gone", () => markRendererNotReady(windowRef));
  win.webContents.on("destroyed", () => markRendererNotReady(windowRef));
  win.on("closed", () => {
    markRendererNotReady(windowRef);
    collector?.stop();
    collector = null;
    acp?.stop();
    acp = null;
    monitor?.stop();
    monitor = null;
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  // 开发态更新 Dock 图标（正式包由 electron-builder 写入 bundle，无需此调用）
  if (process.platform === "darwin" && developmentIcon) app.dock?.setIcon(developmentIcon);
  store = new SqliteStore(dbPath(app.getPath("userData")));
  memory = createMemoryRuntime({
    getWin: () => win,
    homeDir: app.getPath("home"),
    settings: () => store.getSettings().memory,
    extractor: createRuntimeMemoryExtractor({ loadRegistry: () => ModelRegistry.load() }),
  });
  void memory.initialize();
  ensureLoomAgentDefaults({ homeDir: app.getPath("home"), legacyApiKeyPresent: Boolean(store.getApiKeyEnc()) });
  applyThemeSource();
  canvas = registerCanvas({ getWin: () => win, store, userDataDir: app.getPath("userData"), homeDir: app.getPath("home"), memory, getLocale: () => menuLocale });
  monitor = registerMonitor({ getWin: () => win, store });
  acp = registerAcp({ getWin: () => win, store });
  collector = registerCollector({ getWin: () => win, store });
  registerIpc();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  mcpIpcDispose?.();
  mcpIpcDispose = undefined;
  void canvas?.closeMcp();
  collector?.stop();
  collector = null;
  acp?.stop();
  acp = null;
  monitor?.stop();
  monitor = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
