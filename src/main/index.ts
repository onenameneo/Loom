import "dotenv/config"; // 先加载 .env（ANTHROPIC_API_KEY / MODEL_ID / BASE_URL）
import { join } from "path";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dbPath, SqliteStore } from "./store/sqliteStore";
import type { Store } from "./store/store";
import { registerCanvas } from "./canvas";
import { registerMonitor } from "./monitor";
import { registerAcp } from "./acp";
import { registerCollector } from "./collector";
import {
  accessSources,
  encryptionAvailable,
  resolveModelConfig,
  saveApiKey,
} from "./settings";

// ---------------------------------------------------------------------------
// 主进程：持久化(store) + 设置(safeStorage) + 会话 + 画布引擎(pi 多节点)。
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

function invalidateAgent() {
  canvas?.invalidate(); // 设置变了 → 丢弃所有节点 Agent，下次发送按新配置重建
}

function registerIpc() {
  // ---- settings ----
  ipcMain.handle("settings:get", () => {
    const s = store.getSettings();
    return {
      access: s.access,
      appearance: s.appearance,
      monitor: s.monitor,
      sources: accessSources(store),
      hasKey: Boolean(store.getApiKeyEnc()) || Boolean(process.env.ANTHROPIC_API_KEY),
      encryptionAvailable: encryptionAvailable(),
      resolvedModel: resolveModelConfig(store).model,
      resolvedTheme: resolvedTheme(),
    };
  });
  ipcMain.handle("settings:set", (_e, patch) => {
    store.patchSettings(patch ?? {});
    invalidateAgent();
    return { ok: true, appearance: store.getSettings().appearance };
  });
  ipcMain.handle("settings:setKey", (_e, plain: string) => {
    const r = saveApiKey(store, plain ?? "");
    invalidateAgent();
    return { ok: true, encrypted: r.encrypted };
  });

  // ---- workspaces ----
  ipcMain.handle("ws:list", () => store.listWorkspaces());
  ipcMain.handle("ws:create", (_e, name?: string) => store.createWorkspace(name));
  ipcMain.handle("ws:rename", (_e, { id, name }) => {
    store.renameWorkspace(id, name);
    return { ok: true };
  });
  ipcMain.handle("ws:delete", (_e, id: string) => {
    store.deleteWorkspace(id);
    return { ok: true };
  });
  ipcMain.handle("ws:pin", (_e, { id, pinned }) => {
    store.setPinned(id, pinned);
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
        { label: "新建会话", accelerator: "CmdOrCtrl+N", click: menuAction("new-workspace") },
        { type: "separator" as const },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: menuAction("settings") },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" as const },
    {
      label: "视图",
      submenu: [
        { label: "会话", accelerator: "CmdOrCtrl+1", click: menuAction("surface:workspace") },
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    // 透明窗底，让 macOS 原生 vibrancy 材质透过半透明侧栏显出来（不透明底会盖掉毛玻璃）。
    backgroundColor: "#00000000",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  });
  if (store && !monitor) monitor = registerMonitor({ getWin: () => win, store });
  if (store && !acp) acp = registerAcp({ getWin: () => win, store });
  if (store && !collector) collector = registerCollector({ getWin: () => win, store });
  win.on("ready-to-show", () => win?.show());
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
