import { existsSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import type { NodeLayout, NodeRecord, PersistedMessage } from "../../store/store";
import type { StoredModelSelection } from "../../modelConfig/modelRef";
import { isThinkingLevel, type ThinkingLevel } from "../../modelConfig/thinkingLevels";
import { saveNodeLayout, saveNodeLayouts } from "../../store/layoutPersistence";
import { ancestorChain, descendants, type Seed } from "../core/graph";
import { buildContextPlan, checkpointAttachmentMessages, checkpointContextMessage, isLlmMessage, roleOf, seedMessage, textOf, thinkingOf, type FrozenNodeContext } from "../core/context";
import {
  DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
  collectProjectFileAttachmentCandidates,
  collectSkillAttachmentCandidates,
  collectToolResultReferenceCandidates,
  type LoomContextAttachmentCandidate,
} from "../core/attachments";
import {
  accountTranscriptTokens,
  allocateContextBudget,
  estTokens,
  estimateMessageTokensUnbounded,
  type Budget,
  type ContextBudgetAllocation,
  type ContextModelMetadata,
  type TokenDiagnosticInput,
} from "../core/budget";
import {
  applyToolResultBudget,
  createToolResultBudgetState,
  persistToolResultSidecars,
  toolResultSidecarPathForMessage,
  type ToolResultBudgetState,
} from "../core/toolResultBudget";
import {
  applyToolResultMicroCompact,
  createToolResultMicroCompactState,
  DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES,
  DEFAULT_TOOL_RESULT_MICROCOMPACT_KEEP_RECENT,
  type ToolResultMicroCompactDiagnostics,
  type ToolResultMicroCompactState,
} from "../core/toolResultMicroCompact";
import { isLoomContextCheckpoint, isLoomFrozenBranchSummary, type LoomBudgetDiagnostics, type LoomCompactionReason, type LoomUsageDiagnostic } from "../core/messages";
import type { AgentTool } from "../core/tool";
import type { CommandPort } from "../ports";
import { createHookRegistry, createToolLifecycleHook } from "../hooks";
import { createCommandTool, createDefaultReadonlyTools, createProjectFileTools, createProjectMutationTools } from "../tools";
import { createApprovalBroker } from "./approvalBroker";
import { createApprovalPolicyStore } from "./approvalPolicy";
import { createToolRegistry } from "./toolRuntime";
import { createTurnRunner } from "./turnRunner";
import { createNodeQueryEngine } from "./nodeQueryEngine";
import {
  branchTitleFromCandidates,
  DEFAULT_ROOT_TITLE,
  normalizeGeneratedTitle,
  shouldAutoTitleSession,
  shouldAutoTitleNode,
  UNTITLED_SESSION_TITLE,
} from "../../../common/titleDefaults";
import { createTraceRepository } from "./traceRepository";
import { createTraceTelemetryHook } from "../hooks/events/traceTelemetry";
import { createMetricsTelemetryHook } from "../hooks/events/metricsTelemetry";
import { normalizeLlmUsage, type LlmUsage } from "../core/usage";
import { createCompactionService, type CompactNodeResult, type CompactionServiceDeps } from "./compactionService";
import { createApprovalGate } from "../hooks/tools/approvalGate";
import {
  appendAssistantDeltaToSnapshot,
  appendAssistantThinkingToSnapshot,
  applyLifecycleToSnapshot,
  beginTurnSnapshot,
  createLiveTurnPublisher,
} from "./liveTurns";
import { createNodeRuntimeStore } from "./nodeRuntime";
import {
  buildSkillCatalog,
  compileAvailableSkillsIndex,
  compileSkillContext,
  createSkillEvent,
  createSkillReadTool,
  detectSkillProviderCapabilities,
  replaySkillEvents,
  skillSnapshot,
  type SkillCatalog,
} from "../skills";
import type {
  AgentHook,
  ClockPort,
  EngineFactory,
  EngineHandle,
  EventSinkPort,
  HookDispatcher,
  IdPort,
  LlmEnginePort,
  NodeInit,
  StorePort,
  AgentTelemetryPort,
  TurnLifecycleEvent,
} from "../ports";

// ---------------------------------------------------------------------------
// ② 应用编排 · 单 Session 画布的多节点运行时：图缓存 + 消息持久化编排 + 引擎驱动。
// 只依赖 ① 核心与 ③ 端口（store/engine/events/ids/clock）；不认 pi/electron/sqlite。
// 树运算走 core/graph，上下文装配走 core/context，预算走 core/budget。
// ---------------------------------------------------------------------------

/** 运行时视角的节点（图缓存读快照，含 layout/messageMeta 等运行期字段）。 */
export interface CanvasNode {
  id: string;
  sessionId: string;
  projectId: string;
  parentId?: string;
  title: string;
  seed?: Seed;
  systemPrompt?: string;
  model?: StoredModelSelection;
  thinkingLevel?: ThinkingLevel;
  color?: string;
  layout?: NodeLayout;
  frozenContext?: FrozenNodeContext;
  messages: AgentMessage[];
  messageMeta: unknown[];
}

export interface CanvasRuntimeDeps {
  store: StorePort;
  events: EventSinkPort;
  ids: IdPort;
  clock: ClockPort;
  /** 现取 API key（未配置返回空），用于发送前拦截。 */
  getApiKey: () => string | undefined;
  command?: CommandPort;
  /** Electron app.getPath("userData"). Used for session-local tool result sidecars. */
  userDataDir?: string;
  /** Resolves the final selected model and its context capabilities for a node. */
  resolveContextModel?: (nodeId: string, selection?: StoredModelSelection) => Promise<ContextModelMetadata>;
  compaction?: {
    summarize: CompactionServiceDeps["summarize"];
    tailBudgetTokens?: number;
    manualTailBudgetTokens?: number;
    maxSummaryOutputTokens?: number;
    attachmentBudgetTokens?: number;
  };
  toolResultMicroCompact?: {
    enabled?: boolean;
    idleGapMinutes?: number;
    keepRecentToolResults?: number;
  };
  titleGenerator?: {
    generate(input: { prompt: string; response?: string; signal?: AbortSignal }): Promise<string>;
  };
  /** 注入引擎工厂：由组装根提供 pi 适配器；session 只认端口，引擎缓存持有于 runtime 记录。 */
  createEngine: (hooks: {
    buildContext: (nodeId: string, own: AgentMessage[]) => Message[] | Promise<Message[]>;
    getNodeInit: (nodeId: string) => NodeInit | undefined;
    getTools: (nodeId: string) => AgentTool[];
    /** Runtime-owned event gateway: live-turn snapshots must observe pi deltas. */
    events: EventSinkPort;
    dispatcher: HookDispatcher;
    getCurrentTurnId: (nodeId: string) => string | undefined;
    /** unified telemetry port: pi/turn/compaction lifecycle → projections. */
    telemetry: AgentTelemetryPort;
  }) => EngineFactory;
}

interface CanvasMessageDto {
  role: "user" | "assistant" | "tool" | "skill" | "checkpoint";
  text: string;
  thinking?: string;
  images?: { data: string; mimeType: string }[];
  seq: number;
  usage?: LlmUsage;
  meta?: unknown;
  checkpoint?: {
    id: string;
    kind: "context" | "frozen-branch";
    reason?: LoomCompactionReason;
    createdAt: number;
    coverage: { fromSeq: number; toSeq: number };
    retainedTail?: { fromSeq: number; toSeq: number };
    diagnostics: LoomBudgetDiagnostics;
    summaryUsage?: LoomUsageDiagnostic;
  };
  toolCall?: {
    id: string;
    name: string;
    state: "start" | "update" | "end";
    isError: boolean;
    summary?: string;
    args?: unknown;
    details?: unknown;
    startedAt: number;
    updatedAt: number;
  };
  skillEvent?: {
    eventId: string;
    action: "skill-enabled" | "skill-disabled";
    skillId: string;
    name: string;
    sourcePath: string;
    hash: string;
  };
}

const NO_KEY_ERROR = "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。";
const DEFAULT_SYSTEM_PROMPT = "你是一个冷静、精确、克制的思考助手。回答直接，不啰嗦。";
const DEFAULT_COMPACTION_TAIL_BUDGET_TOKENS = 12_000;
const DEFAULT_MANUAL_COMPACTION_TAIL_BUDGET_TOKENS = 6_000;
const TOOL_RESULT_BUDGET_OPT_OUT_TOOLS = new Set(["project_read_file", "skill_read"]);

export function createCanvasRuntime(deps: CanvasRuntimeDeps) {
  const { store, events: eventSink, ids, clock, getApiKey } = deps;
  const liveTurnPublisher = createLiveTurnPublisher();
  const runtime = createNodeRuntimeStore({ publishLive: (event) => liveTurnPublisher.publish(event) });
  const events: EventSinkPort = {
    emit(nodeId, type, payload) {
      if (type === "delta") {
        runtime.transition(nodeId, (r) =>
          r.liveSnapshot ? { liveSnapshot: appendAssistantDeltaToSnapshot(r.liveSnapshot, String(payload ?? "")) } : {},
        );
      }
      if (type === "thinking_delta") {
        runtime.transition(nodeId, (r) =>
          r.liveSnapshot ? { liveSnapshot: appendAssistantThinkingToSnapshot(r.liveSnapshot, String(payload ?? "")) } : {},
        );
      }
      if (type === "turn" && payload && typeof payload === "object") {
        const lifecycle = payload as TurnLifecycleEvent;
        runtime.transition(nodeId, (r) => {
          if (!r.liveSnapshot) return {};
          return { liveSnapshot: applyLifecycleToSnapshot(r.liveSnapshot, lifecycle) };
        });
      }
      eventSink.emit(nodeId, type, payload);
    },
  };

  /** 记录缺省时建档；已存在则保持 node 对象身份（running turn 闭包持有它）。 */
  function ensureRecord(nodeId: string, node: CanvasNode) {
    const existing = runtime.get(nodeId);
    if (existing) {
      if (!existing.node) runtime.replaceNode(nodeId, node);
    } else {
      runtime.set(nodeId, { node, pendingSkillIds: [] });
    }
  }

  /** 清空 live 投影（终态/invalidate/dispose 共用），无快照时静默。 */
  function clearLiveTurn(nodeId: string) {
    runtime.transition(nodeId, (r) => ({ liveSnapshot: undefined }));
  }

  function startLiveTurn(nodeId: string, turn: { turnId: string; operation: "send" | "regenerate" | "edit-resend" }) {
    const node = loadNode(nodeId);
    if (!node) return;
    runtime.transition(nodeId, (r) => ({
      liveSnapshot: beginTurnSnapshot({ nodeId, sessionId: node.sessionId, turnId: turn.turnId, operation: turn.operation }),
    }));
  }

  async function generateTitle(input: { prompt: string; response?: string; signal?: AbortSignal }): Promise<string> {
    if (!deps.titleGenerator) return normalizeGeneratedTitle(input.prompt, { fallback: UNTITLED_SESSION_TITLE });
    try {
      const title = normalizeGeneratedTitle(await deps.titleGenerator.generate(input), { fallback: "" });
      return title || normalizeGeneratedTitle(input.prompt, { fallback: UNTITLED_SESSION_TITLE });
    } catch {
      return normalizeGeneratedTitle(input.prompt, { fallback: UNTITLED_SESSION_TITLE });
    }
  }

  // ---- 图缓存 & 映射 --------------------------------------------------------

  function persisted(msg: AgentMessage): PersistedMessage {
    const usage = normalizeLlmUsage((msg as any)?.usage);
    return {
      id: ids.message(),
      seq: 0,
      role: roleOf(msg),
      content: msg,
      ...(usage ? { meta: { usage } } : {}),
    };
  }

  function persistedWithId(msg: AgentMessage, id: string): PersistedMessage {
    const usage = normalizeLlmUsage((msg as any)?.usage);
    return { id, seq: 0, role: roleOf(msg), content: msg, ...(usage ? { meta: { usage } } : {}) };
  }

  function toCanvasNode(record: NodeRecord): CanvasNode {
    return {
      id: record.id,
      sessionId: record.sessionId,
      projectId: record.projectId,
      parentId: record.parentId,
      title: record.title,
      seed: record.seed as Seed | undefined,
      systemPrompt: record.systemPrompt,
      model: record.model,
      thinkingLevel: record.thinkingLevel,
      color: record.color,
      layout: record.layout,
      frozenContext: record.frozenContext,
      messages: record.messages.map((m) => m.content),
      messageMeta: record.messages.map((m) => m.meta),
    };
  }

  function hydrateSession(sessionId: string): CanvasNode[] {
    const records = store.listNodes(sessionId);
    const ids = new Set(records.map((record) => record.id));
    for (const [id, rec] of runtime.entries()) {
      if (rec.node.sessionId === sessionId && !ids.has(id) && !queries.state(id)) runtime.delete(id);
    }
    const list = records.map((record) => {
      const current = runtime.get(record.id)?.node;
      if (!current || !queries.state(record.id)) {
        const hydrated = toCanvasNode(record);
        runtime.replaceNode(hydrated.id, hydrated);
        return hydrated;
      }
      // A running turn closes over this object. Keep its transcript identity;
      // only refresh durable node metadata while the turn is in flight.
      current.title = record.title;
      current.thinkingLevel = record.thinkingLevel;
      current.seed = record.seed as Seed | undefined;
      current.systemPrompt = record.systemPrompt;
      current.model = record.model;
      current.color = record.color;
      current.layout = record.layout;
      current.frozenContext = record.frozenContext;
      return current;
    });
    return list;
  }

  function loadNode(nodeId: string): CanvasNode | undefined {
    const cached = runtime.get(nodeId)?.node;
    if (cached) return cached;
    const record = store.getNode(nodeId);
    if (!record) return undefined;
    const node = toCanvasNode(record);
    ensureRecord(node.id, node);
    return node;
  }

  // ---- 上下文装配 & 预算：委托 ① 领域核心 -----------------------------------

  // 技能开关沿图层级继承；它不参与模型 transcript 上下文装配。
  function ancestorsOf(nodeId: string): CanvasNode[] {
    return ancestorChain(nodeId, loadNode);
  }

  function catalogFor(nodeId: string): SkillCatalog {
    const node = loadNode(nodeId);
    return buildSkillCatalog({
      settings: store.getSettings(),
      projects: store.listProjects(),
      projectId: node?.projectId,
    });
  }

  function effectiveSkillsFor(nodeId: string) {
    const node = loadNode(nodeId);
    if (!node) return replaySkillEvents([], catalogFor(nodeId));
    return replaySkillEvents([...ancestorsOf(nodeId), node], catalogFor(nodeId));
  }

  function requestSkillsFor(nodeId: string) {
    const effective = effectiveSkillsFor(nodeId);
    const selectedIds = runtime.get(nodeId)?.pendingSkillIds ?? [];
    if (selectedIds.length === 0) return effective;
    const catalog = catalogFor(nodeId);
    const selected = selectedIds
      .map((id) => catalog.activeSkills.find((skill) => skill.id === id))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    const byId = new Map(effective.skills.map((skill) => [skill.id, skill]));
    for (const skill of selected) {
      byId.set(skill.id, {
        ...skillSnapshot(skill),
        enabledEventId: `prompt:${skill.id}:${skill.hash}`,
        diagnostics: skill.diagnostics,
        current: skill,
      });
    }
    return { ...effective, skills: [...byId.values()] };
  }

  function tokenDiagnostic(messages: AgentMessage[]): TokenDiagnosticInput {
    if (messages.length === 0) return { tokens: 0, exact: true };
    const accounting = accountTranscriptTokens(messages);
    return { tokens: accounting.tokens, exact: accounting.exact };
  }

  async function contextBudgetOf(nodeId: string, pendingUserInput?: AgentMessage): Promise<ContextBudgetAllocation | undefined> {
    const node = loadNode(nodeId);
    if (!node || !deps.resolveContextModel) return undefined;
    const model = await deps.resolveContextModel(nodeId, node.model);
    const skillIndex = compileAvailableSkillsIndex(catalogFor(nodeId).skills);
    const systemPrompt = [node.systemPrompt || DEFAULT_SYSTEM_PROMPT, skillIndex].filter(Boolean).join("\n\n");
    const tools = toolsFor(nodeId);
    const toolText = JSON.stringify(tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })));
    const checkpoint = latestValidCheckpoint(node);
    const uncoveredCheckpointMessages = checkpoint
      ? node.messages.slice(checkpoint.coverage.toSeq + 1)
      : [];
    const projectedMessages = buildContextPlan(node, node.messages, clock.now());
    if (pendingUserInput) projectedMessages.push(pendingUserInput as Message);
    return allocateContextBudget({
      model,
      systemTokens: { tokens: estTokens(systemPrompt.length), exact: false },
      toolTokens: { tokens: estTokens(toolText.length), exact: false },
      frozenBranchTokens: tokenDiagnostic(node.frozenContext?.messages ?? []),
      seedTokens: node.seed ? tokenDiagnostic([seedMessage(node.seed, clock.now())]) : { tokens: 0, exact: true },
      pendingUserInputTokens: pendingUserInput ? tokenDiagnostic([pendingUserInput]) : { tokens: 0, exact: true },
      checkpointSummaryTokens: checkpoint
        ? tokenDiagnostic([
            checkpointContextMessage(checkpoint, clock.now()),
            ...checkpointAttachmentMessages(checkpoint, uncoveredCheckpointMessages, clock.now()),
          ])
        : { tokens: 0, exact: true },
      projectedMessages,
    });
  }

  async function budgetOf(nodeId: string): Promise<Budget> {
    const node = loadNode(nodeId);
    if (!node) return { withoutAncestors: 0, withAncestors: 0, estimated: true };
    const contextBudget = await contextBudgetOf(nodeId);
    if (!contextBudget) {
      const projectedTokens = (messages: Message[]) => estTokens(messages.reduce((sum, msg) => sum + textOf(msg as AgentMessage).length, 0));
      const skillIndex = compileAvailableSkillsIndex(catalogFor(nodeId).skills);
      const systemPrompt = [node.systemPrompt || DEFAULT_SYSTEM_PROMPT, skillIndex].filter(Boolean).join("\n\n");
      const systemTokens = estTokens(systemPrompt.length);
      const toolTokens = estTokens(JSON.stringify(toolsFor(nodeId).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }))).length);
      const projected = systemTokens + toolTokens + projectedTokens(buildContextPlan(node, node.messages, clock.now()));
      return { withoutAncestors: projected, withAncestors: projected, estimated: true };
    }
    return {
      withoutAncestors: contextBudget.projectedInputTokens,
      withAncestors: contextBudget.projectedInputTokens,
      estimated: contextBudget.source !== "exact",
      model: contextBudget.model ? { providerId: contextBudget.model.providerId, modelId: contextBudget.model.modelId } : undefined,
      contextWindowTokens: contextBudget.model?.contextWindowTokens,
      reserveOutputTokens: contextBudget.reserveOutputTokens,
      safeInputBudget: contextBudget.safeInputBudget,
      projectedInputTokens: contextBudget.projectedInputTokens,
      fixedContextTokens: contextBudget.fixedContextTokens,
      nodeLocalTailBudgetTokens: contextBudget.nodeLocalTailBudget,
      attachmentBudgetTokens: contextBudget.attachmentBudgetTokens,
      overflowTokens: contextBudget.overflowTokens,
      status: contextBudget.status,
      source: contextBudget.source,
    };
  }

  function toolResultBudgetStateFor(nodeId: string): ToolResultBudgetState {
    const record = runtime.get(nodeId);
    if (!record) return createToolResultBudgetState();
    if (!record.toolResultBudget) record.toolResultBudget = createToolResultBudgetState();
    return record.toolResultBudget;
  }

  function applyToolResultBudgetFor(node: CanvasNode, messages: Message[]): Message[] {
    const result = applyToolResultBudget(messages, toolResultBudgetStateFor(node.id), {
      skipToolNames: TOOL_RESULT_BUDGET_OPT_OUT_TOOLS,
      referenceFor: (message) =>
        deps.userDataDir ? toolResultSidecarPathForMessage(deps.userDataDir, node.sessionId, message) : `toolResult:${message.toolCallId}`,
    });
    persistToolResultSidecars(result.persistedResults);
    return result.messages;
  }

  function toolResultMicroCompactStateFor(nodeId: string): ToolResultMicroCompactState {
    const record = runtime.get(nodeId);
    if (!record) return createToolResultMicroCompactState();
    if (!record.toolResultMicroCompact) record.toolResultMicroCompact = createToolResultMicroCompactState();
    return record.toolResultMicroCompact;
  }

  function applyToolResultMicroCompactFor(node: CanvasNode, messages: Message[]): Message[] {
    const result = applyToolResultMicroCompact(messages, toolResultMicroCompactStateFor(node.id), {
      enabled: deps.toolResultMicroCompact?.enabled,
      now: clock.now(),
      sourceMessages: node.messages,
      idleGapMinutes: deps.toolResultMicroCompact?.idleGapMinutes ?? DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES,
      keepRecentToolResults: deps.toolResultMicroCompact?.keepRecentToolResults ?? DEFAULT_TOOL_RESULT_MICROCOMPACT_KEEP_RECENT,
      skipToolNames: TOOL_RESULT_BUDGET_OPT_OUT_TOOLS,
      referenceFor: (message) =>
        deps.userDataDir ? toolResultSidecarPathForMessage(deps.userDataDir, node.sessionId, message) : `toolResult:${message.toolCallId}`,
    });
    persistToolResultSidecars(result.persistedResults);
    if (result.diagnostics) emitMicroCompactDiagnostics(node, result.diagnostics);
    return result.messages;
  }

  function projectModelMessages(node: CanvasNode, messages: Message[]): Message[] {
    return applyToolResultMicroCompactFor(node, applyToolResultBudgetFor(node, messages));
  }

  function emitMicroCompactDiagnostics(node: CanvasNode, diagnostics: ToolResultMicroCompactDiagnostics) {
    events.emit(node.id, "microcompact", {
      ...diagnostics,
      at: clock.now(),
    });
  }

  // convertToLlm 接收的 state 已由统一投影初始化/同步；这里过滤 UI-only 后应用 tool result budget。
  function buildContext(nodeId: string, own: AgentMessage[]): Message[] {
    const node = runtime.get(nodeId)?.node;
    if (node && own.length === 0) return effectiveMessages(node) as Message[];
    const messages = own.filter(isLlmMessage);
    return node ? projectModelMessages(node, messages) : messages;
  }

  function effectiveMessages(node: CanvasNode): AgentMessage[] {
    return projectModelMessages(node, buildContextPlan(node, node.messages, clock.now())) as AgentMessage[];
  }

  function getNodeInit(nodeId: string): NodeInit | undefined {
    const n = loadNode(nodeId);
    if (!n) return undefined;
    const skillIndex = compileAvailableSkillsIndex(catalogFor(nodeId).skills);
    return {
      systemPrompt: [n.systemPrompt || DEFAULT_SYSTEM_PROMPT, skillIndex].filter(Boolean).join("\n\n"),
      model: n.model,
      thinkingLevel: n.thinkingLevel ?? "off",
      messages: effectiveMessages(n),
    };
  }

  function sourceRootsFor(nodeId: string): string[] {
    const node = loadNode(nodeId);
    if (!node) return [];
    return store.listProjects().find((project) => project.id === node.projectId)?.sourceRoots ?? [];
  }

  function toolsFor(nodeId: string): AgentTool[] {
    const sourceRoots = sourceRootsFor(nodeId);
    const skillTools = catalogFor(nodeId).activeSkills.length > 0
      ? [
          createSkillReadTool(() => catalogFor(nodeId).activeSkills),
        ]
      : [];
    const commandTools = deps.command
      ? [createCommandTool({
          command: deps.command,
          cwd: sourceRoots[0] ?? process.cwd(),
          workspaceRoots: sourceRoots,
          writableRoots: store.getSettings().permissions.writableRoots,
          getPermissionContext: () => ({ ...store.getSettings().permissions }),
        })]
      : [];
    return [...tools.list(), ...skillTools, ...createProjectFileTools(sourceRoots), ...createProjectMutationTools(sourceRoots), ...commandTools];
  }

  const tools = createToolRegistry(createDefaultReadonlyTools(clock));

  // Hook 扩展面：能力经 registerHook 落卡片；工具生命周期经稳定 Loom 事件输出。
  const hookRegistry = createHookRegistry();
  hookRegistry.use(createToolLifecycleHook(events));
  const traces = createTraceRepository({ now: clock.now });
  hookRegistry.use(createTraceTelemetryHook(traces));
  hookRegistry.use(createMetricsTelemetryHook({
    store,
    getSessionId: (nodeId) => runtime.get(nodeId)?.node?.sessionId,
    now: clock.now,
  }));
  const telemetry: AgentTelemetryPort = { emit: (event) => hookRegistry.telemetry(event) };
  const turns = createTurnRunner({ events, telemetry, runtime, now: clock.now });
  let queries!: ReturnType<typeof createNodeQueryEngine>;
  const approvals = createApprovalBroker({ events, clock });
  const policies = createApprovalPolicyStore({
    isPersistentAllowed: (toolName, target) => Boolean(store.isApprovalPolicyAllowed?.(toolName, target)),
    grantPersistent: (toolName, target) => store.grantApprovalPolicy?.(toolName, target),
  });
  hookRegistry.use(
    createApprovalGate({
      approvals,
      policies,
      getTool: (nodeId, name) => toolsFor(nodeId).find((tool) => tool.name === name),
      setAwaitingApproval: (nodeId, turnId, approval) => queries.setAwaitingApproval(nodeId, turnId, approval),
      setRunning: (nodeId, turnId) => queries.setRunning(nodeId, turnId),
      getPermissionContext: () => store.getSettings().permissions,
      emitPermission: (nodeId, payload) => events.emit(nodeId, "permission", payload),
    }),
  );
  const engineFactory = deps.createEngine({
    buildContext,
    getNodeInit,
    getTools: toolsFor,
    events,
    dispatcher: hookRegistry,
    getCurrentTurnId: (nodeId) => queries.state(nodeId)?.turnId,
    // trace 观测端口：解析当前活跃 turnId，写入 span 仓库。观测是观测面，失败仅告警。
    telemetry,
  });
  // 引擎缓存持有于 NodeRuntime 记录：ensure/peek/drop/invalidateAll 只读 runtime。
  const engine: LlmEnginePort = {
    async ensure(nodeId) {
      const current = runtime.get(nodeId)?.engine;
      const stamp = engineFactory.configStamp(nodeId);
      if (current && current.configStamp === stamp) return current.handle;
      const entry = await engineFactory.build(nodeId);
      runtime.transition(nodeId, () => ({ engine: entry }));
      return entry.handle;
    },
    peek: (nodeId) => runtime.get(nodeId)?.engine?.handle,
    drop: (nodeId) => {
      runtime.transition(nodeId, () => ({ engine: undefined }));
    },
    invalidateAll() {
      for (const nodeId of runtime.keys()) runtime.transition(nodeId, () => ({ engine: undefined }));
    },
    listModels: () => engineFactory.listModels(),
  };
  queries = createNodeQueryEngine({ engine, turns });
  const compaction = deps.compaction
    ? createCompactionService({
        summarize: deps.compaction.summarize,
        store,
        clock,
        ids,
        syncEngine: (nodeId) => {
          const node = runtime.get(nodeId)?.node;
          const handle = engine.peek(nodeId);
          if (node && handle) syncTranscript(handle, node);
        },
        telemetry,
        events,
      })
    : undefined;

  // ---- DTO ------------------------------------------------------------------

  function imagesOf(msg: AgentMessage): { data: string; mimeType: string }[] | undefined {
    const content = (msg as any)?.content;
    if (!Array.isArray(content)) return undefined;
    const images = content
      .filter(
        (c: any): c is ImageContent =>
          c?.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string",
      )
      .map((c) => ({ data: c.data, mimeType: c.mimeType }));
    return images.length ? images : undefined;
  }

  const dto = (n: CanvasNode) => ({
    id: n.id,
    sessionId: n.sessionId,
    projectId: n.projectId,
    parentId: n.parentId,
    title: n.title,
    seed: n.seed,
    hasFrozenContext: Boolean(n.frozenContext?.messages.length),
    frozenContextMessageCount: n.frozenContext?.messages.length ?? 0,
    frozenContextTokenEstimate: n.frozenContext?.messages.reduce(
      (total, message) => total + estimateMessageTokensUnbounded(message as AgentMessage),
      0,
    ) ?? 0,
    systemPrompt: n.systemPrompt,
    model: n.model,
    thinkingLevel: n.thinkingLevel,
    color: n.color,
    layout: n.layout,
    messages: n.messages.flatMap<CanvasMessageDto>((m, seq) => {
      const role = roleOf(m);
      if (role === "loomSkillEvent") {
        return [];
      }
      if (isLoomContextCheckpoint(m)) {
        return [
          {
            role: "checkpoint",
            text: m.summary,
            seq,
            meta: n.messageMeta[seq],
            checkpoint: {
              id: m.id,
              kind: "context",
              reason: m.reason,
              createdAt: m.createdAt,
              coverage: m.coverage,
              retainedTail: m.retainedTail,
              diagnostics: m.diagnostics,
              summaryUsage: m.summaryUsage,
            },
          },
        ];
      }
      if (isLoomFrozenBranchSummary(m)) {
        return [
          {
            role: "checkpoint",
            text: m.summary,
            seq,
            meta: n.messageMeta[seq],
            checkpoint: {
              id: m.id,
              kind: "frozen-branch",
              createdAt: m.createdAt,
              coverage: { fromSeq: m.source.fromSeq, toSeq: m.source.toSeq },
              diagnostics: m.diagnostics,
            },
          },
        ];
      }
      if (role === "toolResult") {
        const anyMsg = m as any;
        const text = textOf(m);
        const toolName = typeof anyMsg.toolName === "string" ? anyMsg.toolName : "tool";
        const toolCallId = typeof anyMsg.toolCallId === "string" ? anyMsg.toolCallId : `tool-${seq}`;
        return [
          {
            role: "tool",
            text,
            seq,
            meta: n.messageMeta[seq],
            toolCall: {
              id: toolCallId,
              name: toolName,
              state: "end" as const,
              isError: Boolean(anyMsg.isError),
              summary: text || (anyMsg.isError ? "error" : "done"),
              details: anyMsg.details ?? anyMsg.content,
              startedAt: 0,
              updatedAt: 0,
            },
          },
        ];
      }
      if (role !== "user" && role !== "assistant") return [];
      const usage = normalizeLlmUsage((m as any)?.usage);
      const thinking = role === "assistant" ? thinkingOf(m) : "";
      return [{ role, text: textOf(m), thinking: thinking || undefined, images: imagesOf(m), seq, usage, meta: n.messageMeta[seq] }];
    }),
    skills: effectiveSkillsFor(n.id).skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceScope: skill.sourceScope,
      sourcePath: skill.sourcePath,
      hash: skill.hash,
      diagnostics: skill.diagnostics,
    })),
    skillContext: compileSkillContext({
      state: effectiveSkillsFor(n.id),
      capabilities: detectSkillProviderCapabilities({ providerId: "anthropic" }),
      now: clock.now(),
    }).diagnostics,
  });

  function descendantsOf(nodeId: string): string[] {
    return descendants(nodeId, runtime.nodes());
  }

  // ---- 转写编排（截断 / 追加增量 / 续写 / 提问）------------------------------

  function syncTranscript(handle: EngineHandle, node: CanvasNode) {
    handle.syncMessages(effectiveMessages(node));
  }

  function truncateTranscript(node: CanvasNode, seqFrom: number, handle?: EngineHandle) {
    invalidateDerivedContextFrom(node, seqFrom);
    store.deleteMessagesFrom(node.id, seqFrom);
    node.messages = node.messages.slice(0, seqFrom);
    node.messageMeta = node.messageMeta.slice(0, seqFrom);
    runtime.transition(node.id, () => ({
      toolResultBudget: createToolResultBudgetState(),
      toolResultMicroCompact: createToolResultMicroCompactState(),
    }));
    if (handle) syncTranscript(handle, node);
  }

  function invalidateDerivedContextFrom(node: CanvasNode, seqFrom: number) {
    for (let seq = 0; seq < Math.min(seqFrom, node.messages.length); seq++) {
      const msg = node.messages[seq];
      if (!isLoomContextCheckpoint(msg) || msg.invalidatedAt !== undefined) continue;
      if (msg.coverage.toSeq < seqFrom && msg.retainedTail.toSeq < seqFrom) continue;
      const invalidated = { ...msg, invalidatedAt: clock.now() } as AgentMessage;
      node.messages[seq] = invalidated;
      store.replaceMessageContent?.(node.id, seq, invalidated);
    }
  }

  function appendDelta(node: CanvasNode, handle: EngineHandle, from: number, turnId?: string) {
    const nextMessages: AgentMessage[] = handle?.messages ?? [];
    const delta = nextMessages.slice(from);
    if (delta.length > 0) {
      const llmMetric = turnId
        ? [...(store.listMetrics?.({ nodeId: node.id }) ?? [])].reverse().find((metric) => metric.kind === "llm" && metric.turnId === turnId)
        : undefined;
      const persistedDelta = delta.map((message) => {
        const item = persisted(message);
        if (roleOf(message) !== "assistant" || !llmMetric) return item;
        return {
          ...item,
          meta: {
            ...(item.meta && typeof item.meta === "object" ? item.meta as Record<string, unknown> : {}),
            ...(llmMetric.durationMs !== undefined ? { durationMs: llmMetric.durationMs } : {}),
            ...(llmMetric.ttftMs !== undefined ? { ttftMs: llmMetric.ttftMs } : {}),
            ...(llmMetric.providerId ? { providerId: llmMetric.providerId } : {}),
            ...(llmMetric.modelId ? { modelId: llmMetric.modelId } : {}),
            status: llmMetric.status,
            turnId,
          },
        };
      });
      store.appendMessages(node.id, persistedDelta);
      node.messages.push(...delta);
      node.messageMeta.push(...persistedDelta.map((message) => message.meta));
    }
  }

  function compactableTail(node: CanvasNode): AgentMessage[] {
    const checkpoint = latestValidCheckpoint(node);
    if (checkpoint) return node.messages.slice(checkpoint.coverage.toSeq + 1).filter(isLlmMessage) as AgentMessage[];
    return node.messages.filter(isLlmMessage) as AgentMessage[];
  }

  function attachmentCandidatesFor(node: CanvasNode, messages: AgentMessage[]): LoomContextAttachmentCandidate[] {
    const candidates = [
      ...collectProjectFileAttachmentCandidates(messages),
      ...collectSkillAttachmentCandidates(effectiveSkillsFor(node.id).skills),
    ];
    if (!deps.userDataDir) return candidates;
    return [
      ...candidates,
      ...collectToolResultReferenceCandidates(messages, (message) => {
        const path = toolResultSidecarPathForMessage(deps.userDataDir!, node.sessionId, message as any);
        return existsSync(path) ? path : undefined;
      }),
    ];
  }

  function latestValidCheckpoint(node: CanvasNode) {
    for (let i = node.messages.length - 1; i >= 0; i--) {
      const msg = node.messages[i];
      if (isLoomContextCheckpoint(msg) && msg.invalidatedAt === undefined) {
        return msg;
      }
    }
    return undefined;
  }

  function hasValidCheckpoint(node: CanvasNode): boolean {
    return node.messages.some((msg) => isLoomContextCheckpoint(msg) && msg.invalidatedAt === undefined);
  }

  async function maybeCompactNode(
    node: CanvasNode,
    trigger: "threshold" | "manual" | "overflow",
    options: { turnId?: string; signal?: AbortSignal; handle?: EngineHandle; pendingUserInput?: AgentMessage } = {},
  ): Promise<CompactNodeResult> {
    if (!compaction) return { ok: false, reason: "not_needed" };
    const contextBudget = await contextBudgetOf(node.id, options.pendingUserInput);
    if (contextBudget?.status === "model-unavailable") {
      const error = contextBudget.model?.diagnostic || "Model context metadata is unavailable.";
      events.emit(node.id, "compaction", { state: "failed", trigger, at: clock.now(), reason: "model-unavailable", error });
      return { ok: false, reason: "unavailable", error };
    }
    if (contextBudget?.status === "fixed-context-overflow") {
      const error = "Fixed context exceeds the selected model input budget.";
      events.emit(node.id, "compaction", { state: "failed", trigger, at: clock.now(), reason: "fixed-context-overflow", error });
      return { ok: false, reason: "fixed_context_overflow", error };
    }
    if (trigger === "threshold" && contextBudget?.status !== "needs-compaction") {
      return { ok: false, reason: "not_needed" };
    }
    const previousCheckpoint = latestValidCheckpoint(node);
    const sourceOffset = previousCheckpoint
      ? node.messages.findIndex((msg, index) => index > previousCheckpoint.coverage.toSeq && isLlmMessage(msg))
      : 0;
    const compactableMessages = compactableTail(node);
    const result = await compaction.compactNode({
      nodeId: node.id,
      turnId: options.turnId,
      trigger,
      messages: compactableMessages,
      sourceOffset: sourceOffset < 0 ? node.messages.length : sourceOffset,
      previousCheckpoint,
      model: contextBudget?.model,
      budget: contextBudget,
      tailBudgetTokens: trigger === "manual"
        ? Math.min(
            contextBudget?.nodeLocalTailBudget ?? Number.POSITIVE_INFINITY,
            deps.compaction?.manualTailBudgetTokens ?? DEFAULT_MANUAL_COMPACTION_TAIL_BUDGET_TOKENS,
          )
        : contextBudget?.nodeLocalTailBudget ?? deps.compaction?.tailBudgetTokens ?? DEFAULT_COMPACTION_TAIL_BUDGET_TOKENS,
      signal: options.signal,
      maxSummaryOutputTokens: deps.compaction?.maxSummaryOutputTokens,
      attachmentCandidates: attachmentCandidatesFor(node, compactableMessages),
      attachmentBudgetTokens: Math.min(
        contextBudget?.attachmentBudgetTokens ?? DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
        deps.compaction?.attachmentBudgetTokens ?? DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
      ),
    });
    if (!result.ok) return result;
    const { checkpoint } = result;
    node.messages.push(checkpoint as unknown as AgentMessage);
    node.messageMeta.push(undefined);
    const handle = options.handle ?? engine.peek(node.id);
    if (handle) syncTranscript(handle, node);
    return result;
  }

  function isContextOverflow(error: unknown): boolean {
    const message = String((error as any)?.message ?? error).toLowerCase();
    return /context|token|maximum|too long|overflow/.test(message) && /overflow|exceed|too long|maximum|context/.test(message);
  }

  async function retrySendAfterOverflow(node: CanvasNode, fromSeq: number) {
    const existingHandle = engine.peek(node.id);
    if (node.messages.length > fromSeq) truncateTranscript(node, fromSeq, existingHandle);
    const compactionResult = await maybeCompactNode(node, "overflow", { handle: existingHandle });
    if (!compactionResult.ok && !hasValidCheckpoint(node)) return { ok: false as const, reason: "overflow" as const };
    let activeTurn: { turnId: string; signal: AbortSignal } | undefined;
    const retry = await queries.run({
      nodeId: node.id,
      operation: "send",
      onTurnStarted: (turn) => { activeTurn = { turnId: turn.turnId, signal: turn.signal }; },
      prepare: async (handle) => {
        syncTranscript(handle, node);
        return { kind: "continue", from: effectiveMessages(node).length };
      },
        finalize: (handle, from) => appendDelta(node, handle, from, activeTurn?.turnId),
    });
    if (!retry.result.ok) {
      if (retry.result.reason === "failed" && isContextOverflow(retry.error)) {
        events.emit(node.id, "error", "上下文仍然超出模型窗口，已停止自动重试。");
        return { ok: false as const, reason: "overflow" as const };
      }
      if (retry.result.reason === "failed") events.emit(node.id, "error", String((retry.error as any)?.message ?? retry.error));
      return { ok: false as const, reason: retry.result.reason };
    }
    return { ok: true as const, recovered: "overflow" as const };
  }

  // ---- 对外方法（一一对应 IPC）---------------------------------------------

  function list(sessionId: string) {
    return hydrateSession(sessionId).map(dto);
  }

  // 打开产品 Session：返回已有节点，或没有则建一条起点。
  function open(sessionId: string) {
    let items = hydrateSession(sessionId);
    if (items.length === 0) {
      const root = toCanvasNode(store.createNode({ sessionId, title: DEFAULT_ROOT_TITLE, titleState: "default" }));
      ensureRecord(root.id, root);
      items = [root];
    }
    return items.map(dto);
  }

  function create(arg: { sessionId: string; parentId?: string; seed?: Seed; title?: string; includeParentContext?: boolean }) {
    const parent = arg.parentId ? loadNode(arg.parentId) : undefined;
    // 父级上下文只在创建这一刻读取一次，复制父节点的当前有效投影。
    const frozenContext = arg.parentId && arg.includeParentContext && parent
      ? { version: 1 as const, messages: [...effectiveMessages(parent)] as Message[] }
      : undefined;
    const node = toCanvasNode(
      store.createNode({
        sessionId: arg.sessionId,
        parentId: arg.parentId,
        title: arg.title ?? (arg.seed ? branchTitleFromCandidates({ selectedText: arg.seed.text }) : DEFAULT_ROOT_TITLE),
        titleState: "default",
        seed: arg.seed,
        frozenContext,
      }),
    );
    if (arg.includeParentContext && parent?.systemPrompt) {
      node.systemPrompt = parent.systemPrompt;
      store.updateNode(node.id, { systemPrompt: parent.systemPrompt });
    }
    ensureRecord(node.id, node);
    return dto(node);
  }

  async function send(arg: { nodeId: string; text: string; images?: { data: string; mimeType: string }[]; skillIds?: string[] }) {
    const node = loadNode(arg.nodeId);
    if (!node) {
      events.emit(arg.nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (!getApiKey()) {
      events.emit(arg.nodeId, "error", NO_KEY_ERROR);
      return { ok: false };
    }
    let activeTurn: { turnId: string; signal: AbortSignal } | undefined;
    let promptFromSeq = node.messages.length;
    const shouldNameSession = arg.text.trim().length > 0 && node.messages.length === 0;
    const query = await queries.run({
      nodeId: arg.nodeId,
      operation: "send",
      onTurnStarted: (turn) => {
        activeTurn = { turnId: turn.turnId, signal: turn.signal };
        startLiveTurn(arg.nodeId, turn);
      },
      prepare: async (handle) => {
        runtime.transition(arg.nodeId, (r) => ({
          pendingSkillIds: [...new Set((arg.skillIds ?? []).map((id) => id.trim()).filter(Boolean))],
        }));
        const text = arg.text.trim();
        const images = (arg.images ?? []).filter((img) => img.data && img.mimeType);
        const content =
          images.length > 0
            ? [
                ...(text ? [{ type: "text", text } satisfies TextContent] : []),
                ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }) satisfies ImageContent),
              ]
            : text;
        const userMessage: AgentMessage = { role: "user", content, timestamp: clock.now() };
        await maybeCompactNode(node, "threshold", {
          turnId: activeTurn?.turnId,
          signal: activeTurn?.signal,
          handle,
          pendingUserInput: userMessage,
        });
        const persistedUser = persisted(userMessage);
        store.appendMessages(arg.nodeId, [persistedUser]);
        node.messages.push(userMessage);
        node.messageMeta.push(persistedUser.meta);
        promptFromSeq = node.messages.length;
        return { kind: "prompt", message: userMessage, from: effectiveMessages(node).length };
      },
      finalize: (handle, from) => {
        appendDelta(node, handle, from);
      },
    });
    runtime.transition(arg.nodeId, (r) => ({ pendingSkillIds: [] }));
    const { result } = query;
    clearLiveTurn(arg.nodeId);
    if (!result.ok) {
      if (result.reason === "failed" && isContextOverflow(query.error)) return retrySendAfterOverflow(node, promptFromSeq);
      if (result.reason === "failed") events.emit(arg.nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
    if (shouldNameSession) {
      const responseText = [...node.messages].reverse().map(textOf).find((text) => text.trim());
      const title = await generateTitle({ prompt: arg.text, response: responseText, signal: activeTurn?.signal });
      const session = store.getSession(node.sessionId);
      if (session && shouldAutoTitleSession(session)) {
        store.renameSession(node.sessionId, title, { titleState: "manual" });
      }
      if (shouldAutoTitleNode(node)) {
        node.title = title;
        store.updateNode(node.id, { title, titleState: "manual" });
        // 回合完成事件可能早于标题模型返回；单独通知 renderer 重载节点元数据，
        // 避免画布与侧栏一直显示“起点”。
        events.emit(node.id, "node_updated", { id: node.id, sessionId: node.sessionId, title });
      }
    }
    await maybeCompactNode(node, "threshold", { turnId: result.turnId });
    return { ok: true };
  }

  function abort(nodeId: string) {
    const active = queries.state(nodeId);
    queries.abort(nodeId);
    clearLiveTurn(nodeId);
    runtime.get(nodeId)?.manualCompact?.abort();
    if (active) approvals.cancelByTurn(nodeId, active.turnId, "aborted");
    return { ok: true };
  }

  async function compact(nodeId: string) {
    const node = loadNode(nodeId);
    if (!node) {
      events.emit(nodeId, "error", "节点不存在。");
      return { ok: false, reason: "node-not-found" };
    }
    if (!compaction) return { ok: false, reason: "unavailable" };
    if (queries.state(nodeId) || runtime.get(nodeId)?.manualCompact !== undefined) return { ok: false, reason: "node_busy" };
    const controller = new AbortController();
    runtime.transition(nodeId, () => ({ manualCompact: controller }));
    try {
      const result = await maybeCompactNode(node, "manual", { signal: controller.signal });
      if (controller.signal.aborted) return { ok: false, reason: "aborted" };
      if (result.ok) return { ok: true, node: dto(node) };
      return { ok: false, reason: result.reason, error: result.error };
    } finally {
      runtime.transition(nodeId, () => ({ manualCompact: undefined }));
    }
  }

  async function regenerate(nodeId: string) {
    const node = loadNode(nodeId);
    if (!node) {
      events.emit(nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (!getApiKey()) {
      events.emit(nodeId, "error", NO_KEY_ERROR);
      return { ok: false };
    }
    const lastUser = [...node.messages].map(roleOf).lastIndexOf("user");
    if (lastUser < 0) return { ok: false };
    let activeTurn: { turnId: string; signal: AbortSignal } | undefined;
    const query = await queries.run({
      nodeId,
      operation: "regenerate",
      onTurnStarted: (turn) => {
        activeTurn = { turnId: turn.turnId, signal: turn.signal };
        startLiveTurn(nodeId, turn);
      },
      prepare: async (handle) => {
        truncateTranscript(node, lastUser + 1, handle);
        await maybeCompactNode(node, "threshold", { turnId: activeTurn?.turnId, signal: activeTurn?.signal, handle });
        return { kind: "continue", from: effectiveMessages(node).length };
      },
      finalize: (handle, from) => appendDelta(node, handle, from, activeTurn?.turnId),
    });
    const { result } = query;
    clearLiveTurn(nodeId);
    if (!result.ok) {
      if (result.reason === "failed") events.emit(nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
    await maybeCompactNode(node, "threshold", { turnId: result.turnId });
    return { ok: true };
  }

  async function editResend(arg: { nodeId: string; seq: number; text: string }) {
    const node = loadNode(arg.nodeId);
    const text = arg.text.trim();
    if (!node || !text) {
      if (!node) events.emit(arg.nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (roleOf(node.messages[arg.seq]) !== "user") return { ok: false };
    if (!getApiKey()) {
      events.emit(arg.nodeId, "error", NO_KEY_ERROR);
      return { ok: false };
    }
    let activeTurn: { turnId: string; signal: AbortSignal } | undefined;
    const query = await queries.run({
      nodeId: arg.nodeId,
      operation: "edit-resend",
      onTurnStarted: (turn) => {
        activeTurn = { turnId: turn.turnId, signal: turn.signal };
        startLiveTurn(arg.nodeId, turn);
      },
      prepare: async (handle) => {
        truncateTranscript(node, arg.seq, handle);
        await maybeCompactNode(node, "threshold", { turnId: activeTurn?.turnId, signal: activeTurn?.signal, handle });
        const userMessage: AgentMessage = { role: "user", content: text, timestamp: clock.now() };
        return { kind: "prompt", message: userMessage, from: effectiveMessages(node).length };
      },
      finalize: (handle, from) => appendDelta(node, handle, from, activeTurn?.turnId),
    });
    const { result } = query;
    clearLiveTurn(arg.nodeId);
    if (!result.ok) {
      if (result.reason === "failed") events.emit(arg.nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
    await maybeCompactNode(node, "threshold", { turnId: result.turnId });
    return { ok: true };
  }

  function setSystemPrompt(arg: { nodeId: string; text: string }) {
    const node = loadNode(arg.nodeId);
    const text = arg.text.trim();
    store.updateNode(arg.nodeId, { systemPrompt: text });
    if (node) node.systemPrompt = text || undefined;
    disposeNode(arg.nodeId, "system prompt changed");
    return { ok: true };
  }

  function update(arg: { nodeId: string; title?: string; color?: string }) {
    const node = loadNode(arg.nodeId);
    if (!node) return { ok: false };
    const title = arg.title?.trim();
    if (title) {
      node.title = title;
      store.updateNode(arg.nodeId, { title, titleState: "manual" });
    }
    if (Object.prototype.hasOwnProperty.call(arg, "color")) {
      const color = arg.color?.trim() ?? "";
      node.color = color || undefined;
      store.updateNode(arg.nodeId, { color });
    }
    return { ok: true, node: dto(node) };
  }

  function updateLayout(arg: { nodeId: string; layout: NodeLayout }) {
    const result = saveNodeLayout(store, arg?.nodeId, arg?.layout);
    if (result.ok) {
      const node = runtime.get(arg.nodeId)?.node;
      if (node) node.layout = arg.layout;
    }
    return result;
  }

  function updateLayouts(items: Array<{ id: string; layout: NodeLayout }>) {
    const result = saveNodeLayouts(store, items);
    if (result.ok) {
      const updated = new Set(result.updatedIds);
      for (const item of items) {
        const node = runtime.get(item.id)?.node;
        if (node && updated.has(item.id)) node.layout = item.layout;
      }
    }
    return result;
  }

  function deleteNode(nodeId: string) {
    const target = loadNode(nodeId);
    if (!target || !target.parentId) return { ok: false, deletedIds: [] };
    hydrateSession(target.sessionId);
    const deletedIds = [nodeId, ...descendantsOf(nodeId)];
    store.deleteNode(nodeId);
    for (const id of deletedIds) {
      // tombstone：generation++ + disposed + abort 活跃 turn；空闲记录立即移除，
      // 活跃 turn 记录在 settle 后清理。
      runtime.markDisposed(id);
      approvals.cancelByNode(id, "node deleted");
      policies.clearNodeSession(id);
    }
    return { ok: true, deletedIds };
  }

  /** 重置运行期附件（保留节点）：generation++（abort 活跃 turn）+ 清引擎 + 清 live 投影。 */
  function disposeNode(nodeId: string, reason: string) {
    runtime.transition(nodeId, (r) => ({
      generation: (r.generation ?? 0) + 1,
      engine: undefined,
      liveSnapshot: undefined,
    }));
    approvals.cancelByNode(nodeId, reason);
    policies.clearNodeSession(nodeId);
  }

  function disposeSession(sessionId: string) {
    for (const node of store.listNodes(sessionId)) {
      runtime.markDisposed(node.id);
      approvals.cancelByNode(node.id, "session deleted");
      policies.clearNodeSession(node.id);
    }
  }

  function disposeProject(projectId: string) {
    for (const session of store.listSessions(projectId)) disposeSession(session.id);
  }

  async function budget(nodeId: string) {
    return budgetOf(nodeId);
  }

  function models() {
    return engine.listModels();
  }

  function setModel(arg: { nodeId: string; model: StoredModelSelection }) {
    const node = loadNode(arg.nodeId);
    const model = typeof arg.model === "string" ? arg.model.trim() : arg.model;
    store.updateNode(arg.nodeId, { model });
    if (node) node.model = typeof model === "string" ? model || undefined : model;
    disposeNode(arg.nodeId, "model changed");
    return { ok: true };
  }

  function setThinkingLevel(arg: { nodeId: string; thinkingLevel: string }) {
    if (!isThinkingLevel(arg.thinkingLevel)) return { ok: false, reason: "invalid-thinking-level" };
    const node = loadNode(arg.nodeId);
    store.updateNode(arg.nodeId, { thinkingLevel: arg.thinkingLevel });
    if (node) node.thinkingLevel = arg.thinkingLevel;
    disposeNode(arg.nodeId, "thinking level changed");
    return { ok: true };
  }

  function reset(nodeId: string) {
    const node = loadNode(nodeId);
    store.deleteMessagesFrom(nodeId, 0);
    if (node) {
      node.messages = [];
      node.messageMeta = [];
    }
    runtime.transition(nodeId, (r) => ({
      generation: (r.generation ?? 0) + 1,
      liveSnapshot: undefined,
      toolResultBudget: createToolResultBudgetState(),
      toolResultMicroCompact: createToolResultMicroCompactState(),
    }));
    approvals.cancelByNode(nodeId, "reset");
    policies.clearNodeSession(nodeId);
    engine.peek(nodeId)?.reset();
    return { ok: true };
  }

  /** 设置变更（模型/baseUrl/key）→ 丢弃所有引擎，下次发送按新配置重建。 */
  function invalidate() {
    for (const nodeId of runtime.keys()) {
      disposeNode(nodeId, "invalidated");
    }
  }

  function decideApproval(decision: Parameters<typeof approvals.decide>[0]) {
    return approvals.decide(decision);
  }

  function listSkills(nodeId: string) {
    const catalog = catalogFor(nodeId);
    const effective = effectiveSkillsFor(nodeId);
    return {
      catalog,
      effective,
      context: compileSkillContext({
        state: effective,
        capabilities: detectSkillProviderCapabilities({ providerId: "anthropic" }),
        now: clock.now(),
      }).diagnostics,
    };
  }

  function appendSkillEvent(arg: { nodeId: string; skillId: string; action: "skill-enabled" | "skill-disabled" }) {
    const node = loadNode(arg.nodeId);
    if (!node) return { ok: false, reason: "node-not-found" };
    const catalog = catalogFor(arg.nodeId);
    const skill = catalog.activeSkills.find((item) => item.id === arg.skillId);
    if (!skill) return { ok: false, reason: "skill-not-found" };
    const event = createSkillEvent({
      eventId: ids.message(),
      action: arg.action,
      skill,
      timestamp: clock.now(),
    }) as unknown as AgentMessage;
    store.appendMessages(arg.nodeId, [persisted(event)]);
    node.messages.push(event);
    node.messageMeta.push(undefined);
    disposeNode(arg.nodeId, "skill configuration changed");
    events.emit(arg.nodeId, "skill", { action: arg.action, skillId: skill.id, name: skill.name });
    return { ok: true, node: dto(node) };
  }

  return {
    list,
    open,
    create,
    send,
    abort,
    regenerate,
    editResend,
    setSystemPrompt,
    update,
    updateLayout,
    updateLayouts,
    deleteNode,
    compact,
    budget,
    models,
    setModel,
    setThinkingLevel,
    reset,
    invalidate,
    decideApproval,
    listSkills,
    liveTurns: () => runtime.listLive(),
    onLiveTurn: (listener: Parameters<typeof liveTurnPublisher.subscribe>[0]) => liveTurnPublisher.subscribe(listener),
    disposeSession,
    disposeProject,
    enableSkill: (arg: { nodeId: string; skillId: string }) => appendSkillEvent({ ...arg, action: "skill-enabled" }),
    disableSkill: (arg: { nodeId: string; skillId: string }) => appendSkillEvent({ ...arg, action: "skill-disabled" }),
    /** 注册一个 hook（H1+ 能力的落点）。 */
    registerHook: (hook: AgentHook) => hookRegistry.use(hook),
    trace: (nodeId: string) => traces.snapshot(nodeId),
    onTrace: (listener: Parameters<typeof traces.subscribe>[0]) => traces.subscribe(listener),
    metrics: (nodeId: string) => ({
      records: store.listMetrics?.({ nodeId }) ?? [],
      totals: store.getMetricTotals?.({ nodeId }),
    }),
  };
}

export const createAgentSession = createCanvasRuntime;
