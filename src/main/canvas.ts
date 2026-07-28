import { BrowserWindow, ipcMain } from "electron";
import type { NodeLayout, Store } from "./store/store";
import { resolveModelConfig } from "./settings";
import { createIpcEventSink } from "./agent/adapters/ipcEventSink";
import { createPiEngine } from "./agent/adapters/piEngine";
import { createIds, systemClock } from "./agent/adapters/runtime";
import { createCanvasRuntime } from "./agent/app/session";
import type { Seed } from "./agent/core/graph";
import type { ApprovalDecision } from "./agent/ports";
import type { StoredModelSelection } from "./modelConfig/modelRef";

// ---------------------------------------------------------------------------
// 画布引擎接线（主进程）：组装洋葱四圈 + 把 node:* IPC 绑定到 ② runtime。
//
//   ④ 适配器：ipcEventSink（→renderer）、piEngine（pi 大脑）、clock/ids
//   ② 编排  ：agent/app/session（Session 图缓存 + 持久化 + 引擎驱动）
//   ① 核心  ：agent/core（图/上下文/预算，纯 TS，runtime 内部调用）
//
// 本文件只做「组装 + IPC 转调」，不含业务逻辑。IPC channel/DTO 形状保持不变。
// ---------------------------------------------------------------------------

export type { Seed };

export function registerCanvas(opts: { getWin: () => BrowserWindow | null; store: Store }) {
  const { getWin, store } = opts;

  const events = createIpcEventSink(getWin);
  const clock = systemClock;
  const ids = createIds(clock);

  const runtime = createCanvasRuntime({
    store,
    events,
    ids,
    clock,
    getApiKey: () => "registry-managed",
    // 注入 pi 引擎工厂：session 只认端口，pi 收敛在适配器。
    createEngine: (hooks) =>
      createPiEngine({
        events,
        resolveModel: () => resolveModelConfig(store),
        buildContext: hooks.buildContext,
        getNodeInit: hooks.getNodeInit,
        getTools: hooks.getTools,
        getProjectRoot: (nodeId) => {
          const node = store.getNode(nodeId);
          if (!node) return undefined;
          return store.listProjects().find((project) => project.id === node.projectId)?.sourceRoots[0];
        },
        dispatcher: hooks.dispatcher,
        getCurrentTurnId: hooks.getCurrentTurnId,
      }),
  });

  // ---- IPC：一一转调 session（channel/入参/出参不变）------------------------

  ipcMain.handle("node:list", (_e, sessionId: string) => runtime.list(sessionId));
  ipcMain.handle("node:open", (_e, sessionId: string) => runtime.open(sessionId));
  ipcMain.handle("node:create", (_e, arg: { sessionId: string; parentId?: string; seed?: Seed; title?: string }) =>
    runtime.create(arg),
  );
  ipcMain.handle("node:send", (_e, arg: { nodeId: string; text: string; images?: { data: string; mimeType: string }[]; skillIds?: string[] }) =>
    runtime.send(arg),
  );
  ipcMain.handle("node:abort", (_e, nodeId: string) => runtime.abort(nodeId));
  ipcMain.handle("node:regenerate", (_e, nodeId: string) => runtime.regenerate(nodeId));
  ipcMain.handle("node:editResend", (_e, arg: { nodeId: string; seq: number; text: string }) => runtime.editResend(arg));
  ipcMain.handle("node:setSystemPrompt", (_e, arg: { nodeId: string; text: string }) => runtime.setSystemPrompt(arg));
  ipcMain.handle("node:update", (_e, arg: { nodeId: string; title?: string; color?: string }) => runtime.update(arg));
  ipcMain.handle("node:updateLayout", (_e, arg: { nodeId: string; layout: NodeLayout }) => runtime.updateLayout(arg));
  ipcMain.handle("node:updateLayouts", (_e, items: Array<{ id: string; layout: NodeLayout }>) =>
    runtime.updateLayouts(items),
  );
  ipcMain.handle("node:delete", (_e, nodeId: string) => runtime.deleteNode(nodeId));
  ipcMain.handle("node:setMount", (_e, arg: { nodeId: string; on: boolean }) => runtime.setMount(arg));
  ipcMain.handle("node:budget", (_e, nodeId: string) => runtime.budget(nodeId));
  ipcMain.handle("node:models", () => runtime.models());
  ipcMain.handle("node:setModel", (_e, arg: { nodeId: string; model: StoredModelSelection }) => runtime.setModel(arg));
  ipcMain.handle("node:reset", (_e, nodeId: string) => runtime.reset(nodeId));
  ipcMain.handle("node:skills", (_e, nodeId: string) => runtime.listSkills(nodeId));
  ipcMain.handle("node:enableSkill", (_e, arg: { nodeId: string; skillId: string }) => runtime.enableSkill(arg));
  ipcMain.handle("node:disableSkill", (_e, arg: { nodeId: string; skillId: string }) => runtime.disableSkill(arg));
  ipcMain.handle("approval:decide", (_e, decision: ApprovalDecision) => runtime.decideApproval(decision));

  /** 设置变更（模型/baseUrl/key）→ 丢弃所有引擎，下次发送按新配置重建。 */
  return { invalidate: () => runtime.invalidate() };
}
