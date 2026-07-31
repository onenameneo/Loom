import type { BrowserWindow } from "electron";
import { sendToWindow } from "../../ipcSafeSend";
import type { EventSinkPort } from "../ports";

// ---------------------------------------------------------------------------
// ④ 适配器 · IPC 事件汇：把 { nodeId, type, payload } 推给 renderer。
// channel 与形状与原 canvas 的 send(...) 逐字一致（"canvas:event"），不改契约。
// ---------------------------------------------------------------------------

export function createIpcEventSink(getWin: () => BrowserWindow | null): EventSinkPort {
  return {
    emit(nodeId, type, payload) {
      sendToWindow(getWin, "canvas:event", { nodeId, type, payload });
    },
  };
}
