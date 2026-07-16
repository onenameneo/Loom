import { BrowserWindow, ipcMain } from "electron";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@mariozechner/pi-ai";
import type { NodeRecord, PersistedMessage, Store } from "./store/store";
import { resolveModelConfig } from "./settings";

// ---------------------------------------------------------------------------
// 画布引擎（主进程）：一张画布 = N 个活的 pi 对话节点，组成一棵树（单父）。
//
//   · 图存储    ：内存态 Map<nodeId, CanvasNode>，edges 由 parentId 导出。
//   · 每节点   ：绑定一个 pi Agent，state.messages = 本节点自己的对话线程。
//   · 上下文引擎：给每个 Agent 装自定义 convertToLlm 闭包，发给 LLM 前从图里
//                现取 [ (可选)祖先链 → (可选)seed 片段 → 本节点消息 ] 组装。
//   · 事件     ：canvas:event { nodeId, type, payload }，type 复用 P0。
//
// 图存储写透 Store，内存 Map 只作为当前会话的读快照。
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = "你是一个冷静、精确、克制的思考助手。回答直接，不啰嗦。";

/** seed = 从来源节点某段回复划选出来的片段快照（不随来源变化）。 */
export type Seed = { text: string; from: string; parent: string };

interface CanvasNode {
  id: string;
  workspaceId: string;
  parentId?: string;
  title: string;
  seed?: Seed;
  systemPrompt?: string;
  model?: string;
  color?: string;
  mountAncestors: boolean;
  messages: AgentMessage[];
  messageMeta: unknown[];
}

/** 主进程侧一个 pi Message 的最小构造（发给 provider 只认 role + content）。 */
type LlmMessage = {
  role: string;
  content: unknown;
  timestamp: number;
};

export function registerCanvas(opts: { getWin: () => BrowserWindow | null; store: Store }) {
  const { getWin, store } = opts;

  const nodes = new Map<string, CanvasNode>();
  const agents = new Map<string, any>();
  let seq = 0;

  function nextId(): string {
    seq += 1;
    return `n${seq}_${Date.now().toString(36)}`;
  }

  function nextMessageId(): string {
    seq += 1;
    return `msg_${Date.now().toString(36)}_${seq.toString(36)}`;
  }

  function send(nodeId: string, type: string, payload?: unknown) {
    getWin()?.webContents.send("canvas:event", { nodeId, type, payload });
  }

  function roleOf(msg: AgentMessage): string {
    return typeof (msg as any)?.role === "string" ? (msg as any).role : "custom";
  }

  function persisted(msg: AgentMessage): PersistedMessage {
    return { id: nextMessageId(), seq: 0, role: roleOf(msg), content: msg };
  }

  function isLlmMessage(msg: AgentMessage): msg is Message {
    const role = roleOf(msg);
    return role === "user" || role === "assistant" || role === "toolResult";
  }

  function toCanvasNode(record: NodeRecord): CanvasNode {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      parentId: record.parentId,
      title: record.title,
      seed: record.seed as Seed | undefined,
      systemPrompt: record.systemPrompt,
      model: record.model,
      color: record.color,
      mountAncestors: record.mountAncestors,
      messages: record.messages.map((m) => m.content),
      messageMeta: record.messages.map((m) => m.meta),
    };
  }

  function hydrateWorkspace(workspaceId: string): CanvasNode[] {
    const records = store.listNodes(workspaceId);
    for (const [id, node] of nodes) {
      if (node.workspaceId === workspaceId) nodes.delete(id);
    }
    const list = records.map(toCanvasNode);
    for (const node of list) nodes.set(node.id, node);
    return list;
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

  // ---- 上下文装配 ------------------------------------------------------------

  /** 沿 parentId 从 root→父收集路径上的节点（不含自身）。 */
  function ancestorChain(nodeId: string): CanvasNode[] {
    const chain: CanvasNode[] = [];
    let cur = nodes.get(nodeId)?.parentId;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const n = loadNode(cur);
      if (!n) break;
      chain.push(n);
      cur = n.parentId;
    }
    return chain.reverse(); // root → 父
  }

  function userMsg(text: string): LlmMessage {
    return { role: "user", content: text, timestamp: Date.now() };
  }
  function asstMsg(text: string): LlmMessage {
    return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() };
  }

  function textOf(msg: AgentMessage): string {
    const content = (msg as any)?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((c: any) => {
        if (c?.type === "text") return c.text ?? "";
        if (c?.type === "thinking") return c.thinking ?? "";
        return "";
      })
      .join("");
  }

  /** 祖先链的对话消息（按 root→父 顺序，user/assistant 交替）。 */
  function ancestorMessages(nodeId: string): LlmMessage[] {
    const out: LlmMessage[] = [];
    for (const n of ancestorChain(nodeId)) {
      for (const m of n.messages) {
        const text = textOf(m);
        if (!text) continue;
        if (roleOf(m) === "assistant") out.push(asstMsg(text));
        else if (roleOf(m) === "user") out.push(userMsg(text));
      }
    }
    return out;
  }

  /** seed 片段包成一条用户侧上下文消息，注入子节点上下文顶部。 */
  function seedMessage(seed: Seed): LlmMessage {
    return userMsg(`（上下文）我以下面这段为出发点继续追问：\n「${seed.text}」`);
  }

  // ---- token 预算（字符估算，跨 endpoint 通用；标注为估算）------------------
  // pi-ai 无同步 token 计数器；自定义 endpoint（如 mimo 代理）也拿不到真实计数，
  // 故统一用字符估算：中英混排粗略 ~2 字符/token。含/不含祖先各给一个数。
  function estTokens(chars: number): number {
    return Math.round(chars / 2);
  }
  function ownChars(node: CanvasNode): number {
    let c = node.seed ? node.seed.text.length : 0;
    for (const m of node.messages) c += textOf(m).length;
    return c;
  }
  function budget(nodeId: string): { withoutAncestors: number; withAncestors: number; estimated: boolean } {
    const node = loadNode(nodeId);
    if (!node) return { withoutAncestors: 0, withAncestors: 0, estimated: true };
    const own = ownChars(node);
    let anc = 0;
    for (const n of ancestorChain(nodeId)) for (const m of n.messages) anc += textOf(m).length;
    return { withoutAncestors: estTokens(own), withAncestors: estTokens(own + anc), estimated: true };
  }

  // ---- 模型构建（沿用 P0：设置优先、env 回退；known 模型当接线模板）----------
  async function buildModel(modelId?: string) {
    const { getModel, getModels } = await import("@mariozechner/pi-ai");
    const cfg = resolveModelConfig(store);
    const selected = modelId || cfg.model;
    const known = getModels("anthropic").some((m: any) => m.id === selected);
    // getModel 返回的是 pi-ai 注册表里的共享引用——必须浅拷贝后再改，
    // 否则会污染注册表（把 claude 模板的 id 改成 mimo），下个节点 build 时
    // known 误判为 true、getModel 又查不到 → “Cannot set ... 'baseUrl'”。
    const base = getModel("anthropic", (known ? selected : "claude-sonnet-4-5") as any);
    if (!base) throw new Error(`未找到可用的模型模板（model=${selected}）。`);
    const model = { ...base };
    if (!known) {
      model.id = selected;
      model.name = selected;
    }
    if (cfg.baseUrl) model.baseUrl = cfg.baseUrl;
    return model;
  }

  /** 惰性创建某节点的 pi Agent，装上按 nodeId 绑定的 convertToLlm。 */
  async function getAgent(nodeId: string) {
    const existing = agents.get(nodeId);
    if (existing) return existing;

    const node = loadNode(nodeId);
    const { Agent } = await import("@mariozechner/pi-agent-core");
    const model = await buildModel(node?.model);
    const agent = new Agent({
      initialState: { systemPrompt: node?.systemPrompt || SYSTEM_PROMPT, model, messages: [...(node?.messages ?? [])] },
      getApiKey: async () => resolveModelConfig(store).apiKey,
      // ★ 分支上下文引擎：本节点发消息前，从图里现取上下文装配。
      convertToLlm: (own: any[]) => {
        const node = nodes.get(nodeId);
        const out: LlmMessage[] = [];
        if (node?.mountAncestors) out.push(...ancestorMessages(nodeId));
        if (node?.seed) out.push(seedMessage(node.seed));
        // 本节点自己的历史消息：标准 LLM 消息透传；UI-only 自定义消息过滤。
        out.push(...own.filter(isLlmMessage));
        return out as any;
      },
    });

    agent.subscribe((event: any) => {
      switch (event.type) {
        case "agent_start":
          send(nodeId, "thinking");
          break;
        case "message_start":
          if (event.message?.role === "assistant") send(nodeId, "assistant_start");
          break;
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta")
            send(nodeId, "delta", event.assistantMessageEvent.delta);
          break;
        case "agent_end":
          send(nodeId, "done");
          break;
      }
    });

    agents.set(nodeId, agent);
    return agent;
  }

  // ---- IPC ------------------------------------------------------------------

  const dto = (n: CanvasNode) => ({
    id: n.id,
    workspaceId: n.workspaceId,
    parentId: n.parentId,
    title: n.title,
    seed: n.seed,
    mountAncestors: n.mountAncestors,
    systemPrompt: n.systemPrompt,
    model: n.model,
    color: n.color,
    messages: n.messages.flatMap((m, seq) => {
      const role = roleOf(m);
      if (role !== "user" && role !== "assistant") return [];
      const usage = (m as any)?.usage;
      return [{ role, text: textOf(m), images: imagesOf(m), seq, usage, meta: n.messageMeta[seq] }];
    }),
  });

  function imagesOf(msg: AgentMessage): { data: string; mimeType: string }[] | undefined {
    const content = (msg as any)?.content;
    if (!Array.isArray(content)) return undefined;
    const images = content
      .filter((c: any): c is ImageContent => c?.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string")
      .map((c) => ({ data: c.data, mimeType: c.mimeType }));
    return images.length ? images : undefined;
  }

  function descendantsOf(nodeId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      for (const node of nodes.values()) {
        if (node.parentId === id) {
          out.push(node.id);
          walk(node.id);
        }
      }
    };
    walk(nodeId);
    return out;
  }

  function syncTranscript(agent: any, node: CanvasNode) {
    agent.state.messages = [...node.messages];
  }

  function truncateTranscript(node: CanvasNode, seqFrom: number, agent?: any) {
    store.deleteMessagesFrom(node.id, seqFrom);
    node.messages = node.messages.slice(0, seqFrom);
    node.messageMeta = node.messageMeta.slice(0, seqFrom);
    if (agent) syncTranscript(agent, node);
  }

  function appendDelta(node: CanvasNode, agent: any, from: number) {
    const nextMessages: AgentMessage[] = agent?.state?.messages ?? [];
    const delta = nextMessages.slice(from);
    if (delta.length > 0) {
      store.appendMessages(node.id, delta.map(persisted));
      node.messages.push(...delta);
      node.messageMeta.push(...delta.map(() => undefined));
    }
  }

  async function continueFrom(node: CanvasNode, agent: any) {
    const from = node.messages.length;
    await agent.continue();
    appendDelta(node, agent, from);
  }

  async function promptFrom(node: CanvasNode, agent: any, msg: AgentMessage) {
    const from = node.messages.length;
    await agent.prompt(msg);
    appendDelta(node, agent, from);
  }

  ipcMain.handle("node:list", (_e, workspaceId: string) => {
    return hydrateWorkspace(workspaceId).map(dto);
  });

  // 打开会话：原子地「返回已有节点，或没有则建一条主线」。
  // IPC 处理器同步无 await → 并发调用（如 StrictMode 双挂载）在主进程串行执行，
  // 第二次调用能看到第一次建的根，避免重复建根的竞态。
  ipcMain.handle("node:open", (_e, workspaceId: string) => {
    let list = hydrateWorkspace(workspaceId);
    if (list.length === 0) {
      const root = toCanvasNode(
        store.createNode({ workspaceId, title: "主线", mountAncestors: false }),
      );
      nodes.set(root.id, root);
      list = [root];
    }
    return list.map(dto);
  });

  ipcMain.handle("node:create", (_e, arg: { workspaceId: string; parentId?: string; seed?: Seed; title?: string }) => {
    const node = toCanvasNode(store.createNode({
      workspaceId: arg.workspaceId,
      parentId: arg.parentId,
      title: arg.title ?? (arg.seed ? "新分支" : "主线"),
      seed: arg.seed,
      mountAncestors: false,
    }));
    nodes.set(node.id, node);
    return dto(node);
  });

  ipcMain.handle("node:send", async (_e, arg: { nodeId: string; text: string; images?: { data: string; mimeType: string }[] }) => {
    const node = loadNode(arg.nodeId);
    if (!node) {
      send(arg.nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (!resolveModelConfig(store).apiKey) {
      send(arg.nodeId, "error", "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。");
      return { ok: false };
    }
    try {
      const agent = await getAgent(arg.nodeId);
      const text = arg.text.trim();
      const images = (arg.images ?? []).filter((img) => img.data && img.mimeType);
      const content =
        images.length > 0
          ? [
              ...(text ? [{ type: "text", text } satisfies TextContent] : []),
              ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }) satisfies ImageContent),
            ]
          : text;
      const userMessage: AgentMessage = { role: "user", content, timestamp: Date.now() };
      store.appendMessages(arg.nodeId, [persisted(userMessage)]);
      node.messages.push(userMessage);
      node.messageMeta.push(undefined);

      await promptFrom(node, agent, userMessage);
      return { ok: true };
    } catch (err: any) {
      send(arg.nodeId, "error", String(err?.message ?? err));
      return { ok: false };
    }
  });

  ipcMain.handle("node:abort", (_e, nodeId: string) => {
    agents.get(nodeId)?.abort?.();
    return { ok: true };
  });

  ipcMain.handle("node:regenerate", async (_e, nodeId: string) => {
    const node = loadNode(nodeId);
    if (!node) {
      send(nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (!resolveModelConfig(store).apiKey) {
      send(nodeId, "error", "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。");
      return { ok: false };
    }
    const lastUser = [...node.messages].map(roleOf).lastIndexOf("user");
    if (lastUser < 0) return { ok: false };
    try {
      const agent = await getAgent(nodeId);
      truncateTranscript(node, lastUser + 1, agent);
      await continueFrom(node, agent);
      return { ok: true };
    } catch (err: any) {
      send(nodeId, "error", String(err?.message ?? err));
      return { ok: false };
    }
  });

  ipcMain.handle("node:editResend", async (_e, arg: { nodeId: string; seq: number; text: string }) => {
    const node = loadNode(arg.nodeId);
    const text = arg.text.trim();
    if (!node || !text) {
      if (!node) send(arg.nodeId, "error", "节点不存在。");
      return { ok: false };
    }
    if (roleOf(node.messages[arg.seq]) !== "user") return { ok: false };
    if (!resolveModelConfig(store).apiKey) {
      send(arg.nodeId, "error", "未配置 API key（去设置填写，或设置 ANTHROPIC_API_KEY）。");
      return { ok: false };
    }
    try {
      const agent = await getAgent(arg.nodeId);
      truncateTranscript(node, arg.seq, agent);
      const userMessage: AgentMessage = { role: "user", content: text, timestamp: Date.now() };
      await promptFrom(node, agent, userMessage);
      return { ok: true };
    } catch (err: any) {
      send(arg.nodeId, "error", String(err?.message ?? err));
      return { ok: false };
    }
  });

  ipcMain.handle("node:setSystemPrompt", (_e, arg: { nodeId: string; text: string }) => {
    const node = loadNode(arg.nodeId);
    const text = arg.text.trim();
    store.updateNode(arg.nodeId, { systemPrompt: text });
    if (node) node.systemPrompt = text || undefined;
    agents.delete(arg.nodeId);
    return { ok: true };
  });

  ipcMain.handle("node:update", (_e, arg: { nodeId: string; title?: string; color?: string }) => {
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
  });

  ipcMain.handle("node:delete", (_e, nodeId: string) => {
    const target = loadNode(nodeId);
    if (!target || !target.parentId) return { ok: false, deletedIds: [] };
    hydrateWorkspace(target.workspaceId);
    const deletedIds = [nodeId, ...descendantsOf(nodeId)];
    store.deleteNode(nodeId);
    for (const id of deletedIds) {
      nodes.delete(id);
      agents.delete(id);
    }
    return { ok: true, deletedIds };
  });

  ipcMain.handle("node:setMount", (_e, arg: { nodeId: string; on: boolean }) => {
    const node = loadNode(arg.nodeId);
    if (node) {
      node.mountAncestors = Boolean(arg.on);
      store.updateNode(arg.nodeId, { mountAncestors: node.mountAncestors });
    }
    return { ok: true, budget: budget(arg.nodeId) };
  });

  ipcMain.handle("node:budget", (_e, nodeId: string) => budget(nodeId));

  ipcMain.handle("node:models", async () => {
    const { getModels } = await import("@mariozechner/pi-ai");
    return getModels("anthropic").map((m: any) => ({ id: String(m.id), name: String(m.name || m.id) }));
  });

  ipcMain.handle("node:setModel", (_e, arg: { nodeId: string; model: string }) => {
    const node = loadNode(arg.nodeId);
    const model = arg.model.trim();
    store.updateNode(arg.nodeId, { model });
    if (node) node.model = model || undefined;
    agents.delete(arg.nodeId);
    return { ok: true };
  });

  ipcMain.handle("node:reset", (_e, nodeId: string) => {
    const node = loadNode(nodeId);
    store.deleteMessagesFrom(nodeId, 0);
    if (node) {
      node.messages = [];
      node.messageMeta = [];
    }
    agents.get(nodeId)?.reset?.();
    return { ok: true };
  });

  /** 设置变更（模型/baseUrl/key）→ 丢弃所有 Agent，下次发送按新配置重建。 */
  function invalidate() {
    agents.clear();
  }

  return { invalidate };
}
