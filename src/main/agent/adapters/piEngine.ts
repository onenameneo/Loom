import type {
  AfterToolCallContext,
  Agent,
  AgentEvent,
  AgentMessage,
  BeforeToolCallContext,
} from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentTool } from "../core/tool";
import type { EngineHandle, EventSinkPort, HookDispatcher, LlmEnginePort, NodeInit } from "../ports";
import { adaptAgentToolsToPi } from "./piTools";

// ---------------------------------------------------------------------------
// ④ 适配器 · pi 引擎：pi（pi-agent-core / pi-ai）的全部使用收敛于此，实现 LlmEnginePort。
// ② 不直接依赖 pi；分支上下文装配经 buildContext 回调转交 ① 领域核心。
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = "你是一个冷静、精确、克制的思考助手。回答直接，不啰嗦。";

/** 已解析的模型配置（结构性契约，避免耦合 settings 的具体类型）。 */
export interface ResolvedModelConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface PiEngineDeps {
  events: EventSinkPort;
  /** 现取模型配置（设置优先、env 回退）。 */
  resolveModel: () => ResolvedModelConfig;
  /** convertToLlm 委托：某节点发送前，交 ① 核心装配上下文。返回 pi Message[]。 */
  buildContext: (nodeId: string, own: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** 创建引擎时读取节点初值（系统提示 / 模型 / 初始转写）。 */
  getNodeInit: (nodeId: string) => NodeInit | undefined;
  /** 创建引擎时读取可用工具（中性契约，由 app 层提供）。 */
  getTools: (nodeId: string) => AgentTool[];
  /** hook 分发器：pi 的 before/afterToolCall/transformContext/事件转发至此。 */
  dispatcher: HookDispatcher;
  /** 当前节点活跃 outer turn id；仅用于把工具调用与应用 turn 相关联。 */
  getCurrentTurnId?: (nodeId: string) => string | undefined;
}

export function createPiEngine(deps: PiEngineDeps): LlmEnginePort {
  const { events, resolveModel, buildContext, getNodeInit, getTools, dispatcher, getCurrentTurnId } = deps;
  const cache = new Map<string, { agent: Agent; handle: EngineHandle }>();

  async function buildModels() {
    const [{ createModels }, { anthropicProvider }] = await Promise.all([
      import("@earendil-works/pi-ai"),
      import("@earendil-works/pi-ai/providers/anthropic"),
    ]);
    const models = createModels();
    models.setProvider(anthropicProvider());
    return models;
  }

  // known 模型当接线模板；未知（自定义 endpoint）以其为壳改 id/baseUrl。
  async function buildModel(models: Awaited<ReturnType<typeof buildModels>>, modelId?: string) {
    const cfg = resolveModel();
    const selected = modelId || cfg.model;
    const known = models.getModels("anthropic").some((m) => m.id === selected);
    const base = models.getModel("anthropic", known ? selected : "claude-sonnet-4-5");
    if (!base) throw new Error(`未找到可用的模型模板（model=${selected}）。`);
    const model = { ...base };
    if (!known) {
      model.id = selected;
      model.name = selected;
    }
    if (cfg.baseUrl) model.baseUrl = cfg.baseUrl;
    return model;
  }

  function wrap(agent: Agent): EngineHandle {
    return {
      prompt: (msg) => agent.prompt(msg),
      continue: () => agent.continue(),
      abort: () => agent.abort?.(),
      reset: () => agent.reset?.(),
      get messages() {
        return agent.state.messages as AgentMessage[];
      },
      syncMessages: (msgs) => {
        agent.state.messages = [...msgs];
      },
    };
  }

  async function ensure(nodeId: string): Promise<EngineHandle> {
    const existing = cache.get(nodeId);
    if (existing) return existing.handle;

    const init = getNodeInit(nodeId);
    const [{ Agent }, models] = await Promise.all([import("@earendil-works/pi-agent-core"), buildModels()]);
    const model = await buildModel(models, init?.model);
    const agent = new Agent({
      initialState: {
        systemPrompt: init?.systemPrompt || SYSTEM_PROMPT,
        model,
        messages: [...(init?.messages ?? [])],
        tools: adaptAgentToolsToPi(getTools(nodeId)),
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: async () => resolveModel().apiKey,
      // ★ 分支上下文引擎：本节点发消息前，委托 ① 核心装配上下文。
      convertToLlm: (own: AgentMessage[]) => buildContext(nodeId, own),
      // ★ Hook 扩展面（装一次即冻结）：pi 的钩子映射成中性上下文，转交分发器。
      //   空注册表下：transformContext 恒等、before/after 返回 undefined → 行为中性。
      transformContext: (messages: AgentMessage[]) => dispatcher.contextTransform(messages),
      beforeToolCall: async ({ toolCall, args }: BeforeToolCallContext) => {
        const d = await dispatcher.toolCall({
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
        });
        return d ? { block: true, reason: d.reason } : undefined;
      },
      afterToolCall: ({ toolCall, args, result, isError }: AfterToolCallContext) =>
        dispatcher.toolResult({
          nodeId,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
          content: result.content,
          details: result.details,
          isError,
          usage: result.usage,
        }),
    });

    agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          events.emit(nodeId, "thinking");
          break;
        case "message_start":
          if (event.message?.role === "assistant") events.emit(nodeId, "assistant_start");
          break;
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta")
            events.emit(nodeId, "delta", event.assistantMessageEvent.delta);
          break;
        case "agent_end":
          events.emit(nodeId, "done");
          break;
      }
      // Hook 观测面：把每个 pi 事件广播给已注册 hook（H1 工具时间线等）。
      dispatcher.event(nodeId, event);
    });

    const handle = wrap(agent);
    cache.set(nodeId, { agent, handle });
    return handle;
  }

  return {
    ensure,
    peek: (nodeId) => cache.get(nodeId)?.handle,
    drop: (nodeId) => {
      cache.delete(nodeId);
    },
    invalidateAll: () => {
      cache.clear();
    },
    async listModels() {
      const models = await buildModels();
      return models.getModels("anthropic").map((m) => ({ id: String(m.id), name: String(m.name || m.id) }));
    },
  };
}
