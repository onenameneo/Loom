import { BrowserWindow, ipcMain } from "electron";
import type { NodeLayout, Store } from "./store/store";
import { resolveModelConfig } from "./settings";
import { sendToWindow } from "./ipcSafeSend";
import { createIpcEventSink } from "./agent/adapters/ipcEventSink";
import { createPiEngine } from "./agent/adapters/piEngine";
import { createIds, systemClock } from "./agent/adapters/runtime";
import { createRuntimeSummarizer } from "./agent/adapters/summarizationAdapter";
import { createRuntimeTitleGenerator } from "./agent/adapters/titleGenerator";
import { createCommandPort } from "./agent/adapters/commandExecutor";
import { createCanvasRuntime } from "./agent/app/session";
import type { Seed } from "./agent/core/graph";
import type { ApprovalDecision } from "./agent/ports";
import type { StoredModelSelection } from "./modelConfig/modelRef";
import type { ThinkingLevel } from "./modelConfig/thinkingLevels";
import { ModelRegistry } from "./modelConfig/registry";
import { createRuntimeModelsFromRegistry } from "./modelConfig/runtimeModels";
import { loadScopedModelSettings, resolveStoredModelSelection } from "./modelConfig/scopes";
import type { ContextModelMetadata } from "./agent/core/budget";
import type { MemoryRuntimePort } from "./memory/runtime";
import type { FileMentionRef } from "../common/fileMentions";
import type { ComposerBudgetPreviewInput } from "../common/composerBudget";
import type { SelectionContextNote } from "../common/selectionContext";
import { createMcpConnectionManager } from "./mcp/connection";
import { createMcpToolProvider } from "./mcp/provider";
import { loadMcpConfiguration, loadMcpConsent, saveMcpConsent } from "./mcp/store";
import { connectEnabledMcpServers } from "./mcp/startup";

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

export function registerCanvas(opts: { getWin: () => BrowserWindow | null; store: Store; userDataDir?: string; homeDir?: string; memory?: MemoryRuntimePort; getLocale?: () => "zh-CN" | "en" }) {
  const { getWin, store } = opts;

  const events = createIpcEventSink(getWin);
  const clock = systemClock;
  const ids = createIds(clock);
  const summarizer = createRuntimeSummarizer({
    resolveModel: async (selection) => ({
      providerId: selection?.providerId,
      modelId: selection?.modelId,
      model: selection?.modelId || resolveModelConfig(store).model,
      contextWindowTokens: selection?.contextWindowTokens,
      maxOutputTokens: selection?.maxOutputTokens,
    }),
    streamSummary: async (summaryModel, messages, options) => {
      const registry = await ModelRegistry.load();
      const scoped = loadScopedModelSettings({});
      const selected = resolveStoredModelSelection({
        registry,
        scoped,
        explicit: summaryModel.providerId && summaryModel.modelId
          ? { providerId: summaryModel.providerId, modelId: summaryModel.modelId }
          : undefined,
      });
      if (!selected.model || !selected.available) throw new Error(selected.diagnostic?.message || "Summary model is unavailable.");
      const models = await createRuntimeModelsFromRegistry(registry);
      const model = models.getModel(selected.ref.providerId, selected.ref.modelId);
      if (!model) throw new Error(`Summary model template not found: ${selected.ref.providerId}/${selected.ref.modelId}`);
      return models.streamSimple(model, { messages }, { signal: options.signal, apiKey: options.apiKey, maxTokens: options.maxOutputTokens });
    },
  });
  const titleGenerator = createRuntimeTitleGenerator({
    loadRegistry: () => ModelRegistry.load(),
  });
  let mcpProvider: ReturnType<typeof createMcpToolProvider>;
  const mcpManager = createMcpConnectionManager({
    isConsentPersisted: (serverId, configRevision) => loadMcpConsent({ homeDir: opts.homeDir })[serverId] === configRevision,
    persistConsent: (serverId, configRevision) => saveMcpConsent({ homeDir: opts.homeDir, serverId, configRevision }),
    onStatus: (status) => sendToWindow(getWin, "mcp:status", status),
    onToolsChanged: (serverId) => mcpProvider?.markToolsChanged(serverId),
  });
  mcpProvider = createMcpToolProvider({
    manager: mcpManager,
    resolveServers: () => loadMcpConfiguration({ homeDir: opts.homeDir }).servers,
    homeDir: opts.homeDir,
  });
  void connectEnabledMcpServers({
    servers: loadMcpConfiguration({ homeDir: opts.homeDir }).servers,
    manager: mcpManager,
    provider: mcpProvider,
  });

  const runtime = createCanvasRuntime({
    store,
    events,
    ids,
    clock,
    getApiKey: () => "registry-managed",
    getLocale: opts.getLocale,
    command: createCommandPort(),
    userDataDir: opts.userDataDir,
    compaction: {
      summarize: (input, options) => summarizer.summarize(input, options),
    },
    resolveContextModel: async (nodeId, selection) => {
      const registry = await ModelRegistry.load();
      const node = store.getNode(nodeId);
      const projectRoot = node
        ? store.listProjects().find((project) => project.id === node.projectId)?.sourceRoots[0]
        : undefined;
      const scoped = loadScopedModelSettings({ projectRoot });
      const selected = resolveStoredModelSelection({ registry, scoped, explicit: selection });
      return {
        providerId: selected.ref.providerId,
        modelId: selected.ref.modelId,
        contextWindowTokens: selected.model?.capabilities.contextWindow ?? 0,
        maxOutputTokens: selected.model?.capabilities.maxOutputTokens ?? 0,
        available: selected.available,
        diagnostic: selected.diagnostic?.message,
      } satisfies ContextModelMetadata;
    },
    titleGenerator,
    memory: opts.memory,
    mcp: mcpProvider,
    // 注入 pi 引擎工厂：session 只认端口，pi 收敛在适配器。
    createEngine: (hooks) =>
      createPiEngine({
        // Use session's wrapped gateway, not the raw IPC sink: this is what
        // updates Node-scoped live snapshots before forwarding canvas events.
        events: hooks.events,
        resolveModel: () => resolveModelConfig(store),
        getLocale: opts.getLocale,
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
  runtime.onTrace((event) => sendToWindow(getWin, "node:trace:update", event));
  runtime.onLiveTurn((event) => sendToWindow(getWin, "canvas:live-turn", event));
  runtime.onApproval((event) => sendToWindow(getWin, "canvas:approval", event));

  // ---- IPC：一一转调 session（channel/入参/出参不变）------------------------

  ipcMain.handle("node:list", (_e, sessionId: string) => runtime.list(sessionId));
  ipcMain.handle("node:plan", (_e, nodeId: string) => runtime.plan(nodeId));
  ipcMain.handle("node:open", (_e, sessionId: string) => runtime.open(sessionId));
  ipcMain.handle("node:create", (_e, arg: { sessionId: string; parentId?: string; seed?: Seed; title?: string; includeParentContext?: boolean }) =>
    runtime.create(arg),
  );
  ipcMain.handle("node:branchFromMessage", (_e, arg: { nodeId: string; sourceSeq: number; mode: "new-session" | "canvas-node" }) =>
    runtime.branchFromMessage(arg),
  );
  ipcMain.handle("node:send", (_e, arg: { nodeId: string; text: string; images?: { data: string; mimeType: string }[]; skillIds?: string[]; mentions?: FileMentionRef[]; selectionNotes?: SelectionContextNote[] }) =>
    runtime.send(arg),
  );
  ipcMain.handle("node:fileCandidates", (_e, arg: { nodeId: string; query?: string }) => runtime.fileCandidates(arg));
  ipcMain.handle("node:abort", (_e, nodeId: string) => runtime.abort(nodeId));
  ipcMain.handle("node:compact", (_e, nodeId: string) => runtime.compact(nodeId));
  ipcMain.handle("node:regenerate", (_e, nodeId: string) => runtime.regenerate(nodeId));
  ipcMain.handle("node:editResend", (_e, arg: { nodeId: string; seq: number; text: string }) => runtime.editResend(arg));
  ipcMain.handle("node:setSystemPrompt", (_e, arg: { nodeId: string; text: string }) => runtime.setSystemPrompt(arg));
  ipcMain.handle("node:update", (_e, arg: { nodeId: string; title?: string; color?: string }) => runtime.update(arg));
  ipcMain.handle("node:updateLayout", (_e, arg: { nodeId: string; layout: NodeLayout }) => runtime.updateLayout(arg));
  ipcMain.handle("node:updateLayouts", (_e, items: Array<{ id: string; layout: NodeLayout }>) =>
    runtime.updateLayouts(items),
  );
  ipcMain.handle("node:delete", (_e, nodeId: string) => runtime.deleteNode(nodeId));
  ipcMain.handle("node:budget", (_e, arg: string | { nodeId: string; preview?: ComposerBudgetPreviewInput }) =>
    typeof arg === "string" ? runtime.budget(arg) : runtime.budget(arg.nodeId, arg.preview),
  );
  ipcMain.handle("node:trace", (_e, nodeId: string) => runtime.trace(nodeId));
  ipcMain.handle("node:metrics", (_e, nodeId: string) => runtime.metrics(nodeId));
  ipcMain.handle("node:models", () => runtime.models());
  ipcMain.handle("node:setModel", (_e, arg: { nodeId: string; model: StoredModelSelection }) => runtime.setModel(arg));
  ipcMain.handle("node:setThinkingLevel", (_e, arg: { nodeId: string; thinkingLevel: ThinkingLevel }) => runtime.setThinkingLevel(arg));
  ipcMain.handle("node:reset", (_e, nodeId: string) => runtime.reset(nodeId));
  ipcMain.handle("node:skills", (_e, nodeId: string) => runtime.listSkills(nodeId));
  ipcMain.handle("node:enableSkill", (_e, arg: { nodeId: string; skillId: string }) => runtime.enableSkill(arg));
  ipcMain.handle("node:disableSkill", (_e, arg: { nodeId: string; skillId: string }) => runtime.disableSkill(arg));
  ipcMain.handle("turns:list", () => runtime.liveTurns());
  ipcMain.handle("approval:list", () => runtime.listApprovals());
  ipcMain.handle("approval:decide", (_e, decision: ApprovalDecision) => runtime.decideApproval(decision));

  /** 设置变更（模型/baseUrl/key）→ 丢弃所有引擎，下次发送按新配置重建。 */
  return {
    invalidate: () => runtime.invalidate(),
    disposeSession: (sessionId: string) => runtime.disposeSession(sessionId),
    disposeProject: (projectId: string) => runtime.disposeProject(projectId),
    closeMcp: () => mcpManager.closeAll(),
    mcp: { manager: mcpManager, provider: mcpProvider },
  };
}
