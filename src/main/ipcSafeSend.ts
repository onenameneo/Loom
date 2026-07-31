import type { BrowserWindow } from "electron";

const readyContents = new WeakSet<Electron.WebContents>();

function isRendererLifecycleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Render frame was disposed|WebFrameMain|Object has been destroyed/i.test(message);
}

export function markRendererReady(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false;
  const { webContents } = win;
  if (!webContents || webContents.isDestroyed()) return false;
  const frame = webContents.mainFrame;
  if (!frame || frame.isDestroyed() || frame.detached) return false;
  readyContents.add(webContents);
  return true;
}

export function markRendererNotReady(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  const { webContents } = win;
  if (!webContents || webContents.isDestroyed()) return;
  readyContents.delete(webContents);
}

export function sendToWindow(getWin: () => BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
  const win = getWin();
  if (!win || win.isDestroyed()) return false;

  const { webContents } = win;
  if (!webContents || webContents.isDestroyed()) return false;
  if (!readyContents.has(webContents)) return false;

  const frame = webContents.mainFrame;
  if (!frame || frame.isDestroyed() || frame.detached) return false;

  try {
    frame.send(channel, ...args);
    return true;
  } catch (error) {
    if (isRendererLifecycleError(error)) return false;
    throw error;
  }
}
