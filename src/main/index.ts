import "dotenv/config"; // 先加载 .env（ANTHROPIC_API_KEY / MODEL_ID / BASE_URL）
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
import { loadScopedModelSettings } from "./modelConfig/scopes";
import { platformWindowOptions } from "./windowOptions";
import { addGlobalSkillSource, buildSkillCatalog, openSkillSource, removeGlobalSkillSource } from "./agent/skills";

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
  // ---- settings ----
  ipcMain.handle("settings:get", async () => {
    const s = store.getSettings();
    const registry = await ModelRegistry.load();
    const scoped = loadScopedModelSettings({ homeDir: app.getPath("home") });
    return {
      access: s.access,
      appearance: s.appearance,
      monitor: s.monitor,
      skills: s.skills,
      modelRegistry: registry.toRendererDTO(),
      globalDefaultModel: scoped.globalSettings.defaults?.model,
      sources: accessSources(store),
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
      legacyKeyPresent: Boolean(store.getApiKeyEnc()),
      keyStorage: keyStorageKind(),
      resolvedModel: resolveModelConfig(store).model,
      resolvedTheme: resolvedTheme(),
    };
  });
  ipcMain.handle("settings:set", (_e, patch) => {
    store.patchSettings(patch ?? {});
    applyThemeSource();
    invalidateAgent();
    return { ok: true, appearance: store.getSettings().appearance };
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
  ipcMain.handle("settings:skills", (_e, projectId?: string) => {
    return buildSkillCatalog({
      settings: store.getSettings(),
      projects: store.listProjects(),
      projectId,
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

  // ---- projects / sessions ----
  const createProject = (input?: string | { name?: string; sourceRoots?: string[] }) => {
    const project = store.createProject(input);
    const session = store.ensureDefaultSession(project.id);
    store.createNode({ sessionId: session.id, title: "主线", mountAncestors: false });
    return project;
  };
  ipcMain.handle("project:list", () => store.listProjects());
  ipcMain.handle("project:create", (_e, input?: string | { name?: string; sourceRoots?: string[] }) => createProject(input));
  ipcMain.handle("project:rename", (_e, { id, name }) => {
    store.renameProject(id, name);
    return { ok: true };
  });
  ipcMain.handle("project:delete", (_e, id: string) => {
    store.deleteProject(id);
    return { ok: true };
  });
  ipcMain.handle("project:pin", (_e, { id, pinned }) => {
    store.setPinned(id, pinned);
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
  ipcMain.handle("session:list", (_e, projectId: string) => {
    store.ensureDefaultSession(projectId);
    return store.listSessions(projectId);
  });
  ipcMain.handle("session:create", (_e, { projectId, title }: { projectId: string; title?: string }) => {
    const session = store.createSession(projectId, title);
    store.createNode({ sessionId: session.id, title: "主线", mountAncestors: false });
    return session;
  });
  ipcMain.handle("session:rename", (_e, { id, title }: { id: string; title: string }) => {
    store.renameSession(id, title);
    return { ok: true };
  });
  ipcMain.handle("session:delete", (_e, id: string) => {
    const session = store.getSession(id);
    if (!session) return { ok: false };
    store.deleteSession(id);
    if (store.listSessions(session.projectId).length === 0) {
      const replacement = store.ensureDefaultSession(session.projectId);
      store.createNode({ sessionId: replacement.id, title: "主线", mountAncestors: false });
    }
    return { ok: true };
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const menuAction = (name: string) => () => win?.webContents.send("menu:action", name);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "文件",
      submenu: [
        { label: "新建项目", accelerator: "CmdOrCtrl+Shift+N", click: menuAction("new-project") },
        { label: "新建会话", accelerator: "CmdOrCtrl+N", click: menuAction("new-session") },
        { type: "separator" as const },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: menuAction("settings") },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" as const },
    {
      label: "视图",
      submenu: [
        { label: "切换侧栏", accelerator: "CmdOrCtrl+\\", click: menuAction("toggle-sidebar") },
        { type: "separator" as const },
        { label: "项目", accelerator: "CmdOrCtrl+1", click: menuAction("surface:project") },
        { label: "工作站", accelerator: "CmdOrCtrl+2", click: menuAction("surface:observatory") },
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
    width: 1160,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    show: false,
    ...platformWindowOptions(process.platform, resolvedTheme() === "dark"),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  });
  if (store && !monitor) monitor = registerMonitor({ getWin: () => win, store });
  if (store && !acp) acp = registerAcp({ getWin: () => win, store });
  if (store && !collector) collector = registerCollector({ getWin: () => win, store });
  win.on("ready-to-show", () => win?.show());
  // 全屏时 macOS 隐藏红绿灯，渲染层据此把侧栏开关移到左缘、收掉预留内边距。
  const emitFullScreen = () => win?.webContents.send("window:fullscreen", win?.isFullScreen() ?? false);
  win.on("enter-full-screen", emitFullScreen);
  win.on("leave-full-screen", emitFullScreen);
  win.webContents.on("did-finish-load", emitFullScreen);
  win.on("closed", () => {
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
  store = new SqliteStore(dbPath(app.getPath("userData")));
  ensureLoomAgentDefaults({ homeDir: app.getPath("home"), legacyApiKeyPresent: Boolean(store.getApiKeyEnc()) });
  applyThemeSource();
  canvas = registerCanvas({ getWin: () => win, store });
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
