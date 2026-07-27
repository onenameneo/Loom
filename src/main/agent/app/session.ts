import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import type { NodeLayout, NodeRecord, PersistedMessage } from "../../store/store";
import { saveNodeLayout, saveNodeLayouts } from "../../store/layoutPersistence";
import { ancestorChain, descendants, type Seed } from "../core/graph";
import { buildContextPlan, isLlmMessage, roleOf, textOf } from "../core/context";
import { budget as computeBudget, type Budget } from "../core/budget";
import type { AgentTool } from "../core/tool";
import { createHookRegistry, createToolLifecycleHook } from "../hooks";
import { createDefaultReadonlyTools, createProjectFileTools, createProjectMutationTools } from "../tools";
import { createApprovalBroker } from "./approvalBroker";
import { createApprovalPolicyStore } from "./approvalPolicy";
import { createToolRegistry } from "./toolRuntime";
import { createTurnRunner } from "./turnRunner";
import { createNodeQueryEngine } from "./nodeQueryEngine";
import { createApprovalGate } from "../hooks/tools/approvalGate";
import type {
  AgentHook,
  ClockPort,
  EngineHandle,
  EventSinkPort,
  HookDispatcher,
  IdPort,
  LlmEnginePort,
  NodeInit,
  StorePort,
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
  model?: string;
  color?: string;
  layout?: NodeLayout;
  mountAncestors: boolean;
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
  /** 注入引擎工厂：由组装根提供 pi 适配器；session 只认端口。 */
  createEngine: (hooks: {
    buildContext: (nodeId: string, own: AgentMessage[]) => Message[] | Promise<Message[]>;
    getNodeInit: (nodeId: string) => NodeInit | undefined;
    getTools: (nodeId: string) => AgentTool[];
    dispatcher: HookDispatcher;
    getCurrentTurnId: (nodeId: string) => string | undefined;
  }) => LlmEnginePort;
}

interface CanvasMessageDto {
  role: "user" | "assistant" | "tool";
  text: string;
  images?: { data: string; mimeType: string }[];
  seq: number;
  usage?: { totalTokens?: number };
  meta?: unknown;
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
}

const NO_KEY_ERROR = "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。";

export function createCanvasRuntime(deps: CanvasRuntimeDeps) {
  const { store, events, ids, clock, getApiKey } = deps;
  const nodes = new Map<string, CanvasNode>();
  let activeSessionId: string | undefined;

  // ---- 图缓存 & 映射 --------------------------------------------------------

  function persisted(msg: AgentMessage): PersistedMessage {
    return { id: ids.message(), seq: 0, role: roleOf(msg), content: msg };
  }

  function toCanvasNode(record: NodeRecord): CanvasNode {
    return {
      id: record.id,
      sessionId: record.sessionId,
      projectId: record.workspaceId,
      parentId: record.parentId,
      title: record.title,
      seed: record.seed as Seed | undefined,
      systemPrompt: record.systemPrompt,
      model: record.model,
      color: record.color,
      layout: record.layout,
      mountAncestors: record.mountAncestors,
      messages: record.messages.map((m) => m.content),
      messageMeta: record.messages.map((m) => m.meta),
    };
  }

  function hydrateSession(sessionId: string): CanvasNode[] {
    const records = store.listNodes(sessionId);
    for (const [id, node] of nodes) {
      if (node.sessionId === sessionId) nodes.delete(id);
    }
    const list = records.map(toCanvasNode);
    for (const node of list) nodes.set(node.id, node);
    return list;
  }

  function activateSession(sessionId: string) {
    if (activeSessionId === sessionId) return;
    activeSessionId = sessionId;
    for (const node of nodes.values()) {
      if (node.sessionId === sessionId) continue;
      queries.invalidate(node.id);
      approvals.cancelByNode(node.id, "session changed");
      policies.clearNodeSession(node.id);
      engine.drop(node.id);
    }
  }

  function loadNode(nodeId: string): CanvasNode | undefined {
    const cached = nodes.get(nodeId);
    if (cached) return cached;
    const record = store.getNode(nodeId);
    if (!record) return undefined;
    const node = toCanvasNode(record);
    nodes.set(node.id, node);
    return node;
  }

  // ---- 上下文装配 & 预算：委托 ① 领域核心 -----------------------------------

  function ancestorsOf(nodeId: string): CanvasNode[] {
    return ancestorChain(nodeId, loadNode);
  }

  function budgetOf(nodeId: string): Budget {
    const node = loadNode(nodeId);
    if (!node) return { withoutAncestors: 0, withAncestors: 0, estimated: true };
    return computeBudget(node, ancestorsOf(nodeId));
  }

  // convertToLlm 委托：本节点发送前，交 ① 核心装配 [祖先? → seed? → 本节点历史]。
  function buildContext(nodeId: string, own: AgentMessage[]): Message[] {
    const node = nodes.get(nodeId);
    if (!node) return own.filter(isLlmMessage);
    const ancestors = node.mountAncestors ? ancestorsOf(nodeId) : [];
    return buildContextPlan(node, own, ancestors, clock.now());
  }

  function getNodeInit(nodeId: string): NodeInit | undefined {
    const n = loadNode(nodeId);
    return n ? { systemPrompt: n.systemPrompt, model: n.model, messages: n.messages } : undefined;
  }

  function sourceFoldersFor(nodeId: string): string[] {
    const node = loadNode(nodeId);
    if (!node) return [];
    return store.listWorkspaces().find((project) => project.id === node.projectId)?.sourceFolders ?? [];
  }

  function toolsFor(nodeId: string): AgentTool[] {
    const sourceFolders = sourceFoldersFor(nodeId);
    return [...tools.list(), ...createProjectFileTools(sourceFolders), ...createProjectMutationTools(sourceFolders)];
  }

  const tools = createToolRegistry(createDefaultReadonlyTools(clock));

  // Hook 扩展面：能力经 registerHook 落卡片；工具生命周期经稳定 Loom 事件输出。
  const hookRegistry = createHookRegistry();
  hookRegistry.use(createToolLifecycleHook(events));
  const turns = createTurnRunner({ events });
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
    }),
  );
  const engine = deps.createEngine({
    buildContext,
    getNodeInit,
    getTools: toolsFor,
    dispatcher: hookRegistry,
    getCurrentTurnId: (nodeId) => queries.state(nodeId)?.turnId,
  });
  queries = createNodeQueryEngine({ engine, turns });

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
    workspaceId: n.sessionId,
    parentId: n.parentId,
    title: n.title,
    seed: n.seed,
    mountAncestors: n.mountAncestors,
    systemPrompt: n.systemPrompt,
    model: n.model,
    color: n.color,
    layout: n.layout,
    messages: n.messages.flatMap<CanvasMessageDto>((m, seq) => {
      const role = roleOf(m);
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
      const usage = (m as any)?.usage;
      return [{ role, text: textOf(m), images: imagesOf(m), seq, usage, meta: n.messageMeta[seq] }];
    }),
  });

  function descendantsOf(nodeId: string): string[] {
    return descendants(nodeId, nodes.values());
  }

  // ---- 转写编排（截断 / 追加增量 / 续写 / 提问）------------------------------

  function syncTranscript(handle: EngineHandle, node: CanvasNode) {
    handle.syncMessages(node.messages);
  }

  function truncateTranscript(node: CanvasNode, seqFrom: number, handle?: EngineHandle) {
    store.deleteMessagesFrom(node.id, seqFrom);
    node.messages = node.messages.slice(0, seqFrom);
    node.messageMeta = node.messageMeta.slice(0, seqFrom);
    if (handle) syncTranscript(handle, node);
  }

  function appendDelta(node: CanvasNode, handle: EngineHandle, from: number) {
    const nextMessages: AgentMessage[] = handle?.messages ?? [];
    const delta = nextMessages.slice(from);
    if (delta.length > 0) {
      store.appendMessages(node.id, delta.map(persisted));
      node.messages.push(...delta);
      node.messageMeta.push(...delta.map(() => undefined));
    }
  }

  // ---- 对外方法（一一对应 IPC）---------------------------------------------

  function list(sessionId: string) {
    return hydrateSession(sessionId).map(dto);
  }

  // 打开产品 Session：返回已有节点，或没有则建一条主线。
  function open(sessionId: string) {
    activateSession(sessionId);
    let items = hydrateSession(sessionId);
    if (items.length === 0) {
      const root = toCanvasNode(store.createNode({ sessionId, title: "主线", mountAncestors: false }));
      nodes.set(root.id, root);
      items = [root];
    }
    return items.map(dto);
  }

  function create(arg: { sessionId: string; parentId?: string; seed?: Seed; title?: string }) {
    const node = toCanvasNode(
      store.createNode({
        sessionId: arg.sessionId,
        parentId: arg.parentId,
        title: arg.title ?? (arg.seed ? "新分支" : "主线"),
        seed: arg.seed,
        mountAncestors: false,
      }),
    );
    nodes.set(node.id, node);
    return dto(node);
  }

  async function send(arg: { nodeId: string; text: string; images?: { data: string; mimeType: string }[] }) {
    const node = loadNode(arg.nodeId);
    if (!node) {
      events.emit(arg.nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (!getApiKey()) {
      events.emit(arg.nodeId, "error", NO_KEY_ERROR);
      return { ok: false };
    }
    const query = await queries.run({
      nodeId: arg.nodeId,
      operation: "send",
      prepare: () => {
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
        store.appendMessages(arg.nodeId, [persisted(userMessage)]);
        node.messages.push(userMessage);
        node.messageMeta.push(undefined);
        return { kind: "prompt", message: userMessage, from: node.messages.length };
      },
      finalize: (handle, from) => appendDelta(node, handle, from),
    });
    const { result } = query;
    if (!result.ok) {
      if (result.reason === "failed") events.emit(arg.nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
    return { ok: true };
  }

  function abort(nodeId: string) {
    const active = queries.state(nodeId);
    queries.abort(nodeId);
    if (active) approvals.cancelByTurn(nodeId, active.turnId, "aborted");
    return { ok: true };
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
    const query = await queries.run({
      nodeId,
      operation: "regenerate",
      prepare: (handle) => {
        truncateTranscript(node, lastUser + 1, handle);
        return { kind: "continue", from: node.messages.length };
      },
      finalize: (handle, from) => appendDelta(node, handle, from),
    });
    const { result } = query;
    if (!result.ok) {
      if (result.reason === "failed") events.emit(nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
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
    const query = await queries.run({
      nodeId: arg.nodeId,
      operation: "edit-resend",
      prepare: (handle) => {
        truncateTranscript(node, arg.seq, handle);
        const userMessage: AgentMessage = { role: "user", content: text, timestamp: clock.now() };
        return { kind: "prompt", message: userMessage, from: node.messages.length };
      },
      finalize: (handle, from) => appendDelta(node, handle, from),
    });
    const { result } = query;
    if (!result.ok) {
      if (result.reason === "failed") events.emit(arg.nodeId, "error", String((query.error as any)?.message ?? query.error));
      return { ok: false, reason: result.reason };
    }
    return { ok: true };
  }

  function setSystemPrompt(arg: { nodeId: string; text: string }) {
    const node = loadNode(arg.nodeId);
    const text = arg.text.trim();
    store.updateNode(arg.nodeId, { systemPrompt: text });
    if (node) node.systemPrompt = text || undefined;
    queries.invalidate(arg.nodeId);
    approvals.cancelByNode(arg.nodeId, "system prompt changed");
    policies.clearNodeSession(arg.nodeId);
    engine.drop(arg.nodeId);
    return { ok: true };
  }

  function update(arg: { nodeId: string; title?: string; color?: string }) {
    const node = loadNode(arg.nodeId);
    if (!node) return { ok: false };
    const title = arg.title?.trim();
    if (title) {
      node.title = title;
      store.updateNode(arg.nodeId, { title });
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
      const node = nodes.get(arg.nodeId);
      if (node) node.layout = arg.layout;
    }
    return result;
  }

  function updateLayouts(items: Array<{ id: string; layout: NodeLayout }>) {
    const result = saveNodeLayouts(store, items);
    if (result.ok) {
      const updated = new Set(result.updatedIds);
      for (const item of items) {
        const node = nodes.get(item.id);
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
      nodes.delete(id);
      queries.invalidate(id);
      approvals.cancelByNode(id, "node deleted");
      policies.clearNodeSession(id);
      engine.drop(id);
    }
    return { ok: true, deletedIds };
  }

  function setMount(arg: { nodeId: string; on: boolean }) {
    const node = loadNode(arg.nodeId);
    if (node) {
      node.mountAncestors = Boolean(arg.on);
      store.updateNode(arg.nodeId, { mountAncestors: node.mountAncestors });
    }
    return { ok: true, budget: budgetOf(arg.nodeId) };
  }

  function budget(nodeId: string) {
    return budgetOf(nodeId);
  }

  function models() {
    return engine.listModels();
  }

  function setModel(arg: { nodeId: string; model: string }) {
    const node = loadNode(arg.nodeId);
    const model = arg.model.trim();
    store.updateNode(arg.nodeId, { model });
    if (node) node.model = model || undefined;
    queries.invalidate(arg.nodeId);
    approvals.cancelByNode(arg.nodeId, "model changed");
    policies.clearNodeSession(arg.nodeId);
    engine.drop(arg.nodeId);
    return { ok: true };
  }

  function reset(nodeId: string) {
    const node = loadNode(nodeId);
    store.deleteMessagesFrom(nodeId, 0);
    if (node) {
      node.messages = [];
      node.messageMeta = [];
    }
    queries.invalidate(nodeId);
    approvals.cancelByNode(nodeId, "reset");
    policies.clearNodeSession(nodeId);
    engine.peek(nodeId)?.reset();
    return { ok: true };
  }

  /** 设置变更（模型/baseUrl/key）→ 丢弃所有引擎，下次发送按新配置重建。 */
  function invalidate() {
    queries.invalidateAll();
    for (const nodeId of nodes.keys()) {
      approvals.cancelByNode(nodeId, "invalidated");
      policies.clearNodeSession(nodeId);
    }
    engine.invalidateAll();
  }

  function decideApproval(decision: Parameters<typeof approvals.decide>[0]) {
    return approvals.decide(decision);
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
    setMount,
    budget,
    models,
    setModel,
    reset,
    invalidate,
    decideApproval,
    /** 注册一个 hook（H1+ 能力的落点）。 */
    registerHook: (hook: AgentHook) => hookRegistry.use(hook),
  };
}

export const createAgentSession = createCanvasRuntime;
