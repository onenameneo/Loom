import { contextBridge, ipcRenderer } from "electron";

type CanvasEvent = { nodeId: string; type: string; payload?: unknown };

const api = {
  canvas: {
    list: (workspaceId: string): Promise<any[]> => ipcRenderer.invoke("node:list", workspaceId),
    open: (workspaceId: string): Promise<any[]> => ipcRenderer.invoke("node:open", workspaceId),
    create: (arg: { workspaceId: string; parentId?: string; seed?: any; title?: string }): Promise<any> =>
      ipcRenderer.invoke("node:create", arg),
    send: (nodeId: string, text: string, images?: { data: string; mimeType: string }[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:send", { nodeId, text, images }),
    abort: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:abort", nodeId),
    regenerate: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:regenerate", nodeId),
    editResend: (arg: { nodeId: string; seq: number; text: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:editResend", arg),
    delete: (nodeId: string): Promise<{ ok: boolean; deletedIds: string[] }> =>
      ipcRenderer.invoke("node:delete", nodeId),
    setSystemPrompt: (nodeId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:setSystemPrompt", { nodeId, text }),
    update: (nodeId: string, patch: { title?: string; color?: string }): Promise<{ ok: boolean; node?: any }> =>
      ipcRenderer.invoke("node:update", { nodeId, ...patch }),
    setMount: (nodeId: string, on: boolean): Promise<{ ok: boolean; budget: any }> =>
      ipcRenderer.invoke("node:setMount", { nodeId, on }),
    setModel: (nodeId: string, model: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("node:setModel", { nodeId, model }),
    models: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke("node:models"),
    budget: (nodeId: string): Promise<{ withoutAncestors: number; withAncestors: number; estimated: boolean }> =>
      ipcRenderer.invoke("node:budget", nodeId),
    reset: (nodeId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("node:reset", nodeId),
    onEvent: (cb: (e: CanvasEvent) => void) => {
      const l = (_: unknown, d: CanvasEvent) => cb(d);
      ipcRenderer.on("canvas:event", l);
      return () => ipcRenderer.removeListener("canvas:event", l);
    },
  },
  settings: {
    get: (): Promise<any> => ipcRenderer.invoke("settings:get"),
    set: (patch: any): Promise<any> => ipcRenderer.invoke("settings:set", patch),
    setKey: (plain: string): Promise<{ ok: boolean; encrypted: boolean }> =>
      ipcRenderer.invoke("settings:setKey", plain),
  },
  workspaces: {
    list: (): Promise<any[]> => ipcRenderer.invoke("ws:list"),
    create: (name?: string): Promise<any> => ipcRenderer.invoke("ws:create", name),
    rename: (id: string, name: string): Promise<any> =>
      ipcRenderer.invoke("ws:rename", { id, name }),
    delete: (id: string): Promise<any> => ipcRenderer.invoke("ws:delete", id),
    pin: (id: string, pinned: boolean): Promise<any> =>
      ipcRenderer.invoke("ws:pin", { id, pinned }),
  },
  onMenu: (cb: (action: string) => void) => {
    const l = (_: unknown, action: string) => cb(action);
    ipcRenderer.on("menu:action", l);
    return () => ipcRenderer.removeListener("menu:action", l);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type CanvasApi = typeof api;
