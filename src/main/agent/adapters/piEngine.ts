import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { EngineHandle, EventSinkPort, HookDispatcher, LlmEnginePort, NodeInit } from "../ports";

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
  buildContext: (nodeId: string, own: AgentMessage[]) => any;
  /** 创建引擎时读取节点初值（系统提示 / 模型 / 初始转写）。 */
  getNodeInit: (nodeId: string) => NodeInit | undefined;
  /** hook 分发器：pi 的 before/afterToolCall/transformContext/事件转发至此。 */
  dispatcher: HookDispatcher;
}

export function createPiEngine(deps: PiEngineDeps): LlmEnginePort {
  const { events, resolveModel, buildContext, getNodeInit, dispatcher } = deps;
  const cache = new Map<string, { agent: any; handle: EngineHandle }>();

  // known 模型当接线模板；未知（自定义 endpoint）以其为壳改 id/baseUrl。
  async function buildModel(modelId?: string) {
    const { getModel, getModels } = await import("@mariozechner/pi-ai");
    const cfg = resolveModel();
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

  function wrap(agent: any): EngineHandle {
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
    const { Agent } = await import("@mariozechner/pi-agent-core");
    const model = await buildModel(init?.model);
    const agent = new Agent({
      initialState: {
        systemPrompt: init?.systemPrompt || SYSTEM_PROMPT,
        model,
        messages: [...(init?.messages ?? [])],
      },
      getApiKey: async () => resolveModel().apiKey,
      // ★ 分支上下文引擎：本节点发消息前，委托 ① 核心装配上下文。
      convertToLlm: (own: any[]) => buildContext(nodeId, own),
      // ★ Hook 扩展面（装一次即冻结）：pi 的钩子映射成中性上下文，转交分发器。
      //   空注册表下：transformContext 恒等、before/after 返回 undefined → 行为中性。
      transformContext: (messages: AgentMessage[]) => dispatcher.contextTransform(messages),
      beforeToolCall: async ({ toolCall, args }: any) => {
        const d = await dispatcher.toolCall({ nodeId, toolName: toolCall.name, toolCallId: toolCall.id, args });
        return d ? { block: true, reason: d.reason } : undefined;
      },
      afterToolCall: ({ toolCall, args, result, isError }: any) =>
        dispatcher.toolResult({
          nodeId,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
          content: result.content,
          details: result.details,
          isError,
        }),
    });

    agent.subscribe((event: any) => {
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
      const { getModels } = await import("@mariozechner/pi-ai");
      return getModels("anthropic").map((m: any) => ({ id: String(m.id), name: String(m.name || m.id) }));
    },
  };
}
