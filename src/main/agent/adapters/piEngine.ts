import type {
  AfterToolCallContext,
  Agent,
  AgentEvent,
  AgentMessage,
  BeforeToolCallContext,
} from "@earendil-works/pi-agent-core";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentTool } from "../core/tool";
import type { EngineCacheEntry, EngineFactory, EngineHandle, EventSinkPort, HookDispatcher, NodeInit, TracePort } from "../ports";
import { adaptAgentToolsToPi } from "./piTools";
import { migrateLegacyModelRef, parseStoredModelRef, type StoredModelSelection } from "../../modelConfig/modelRef";
import { ModelRegistry } from "../../modelConfig/registry";
import { createRuntimeModelsFromRegistry } from "../../modelConfig/runtimeModels";
import { loadScopedModelSettings, resolveSelectedModel } from "../../modelConfig/scopes";
import { globalSettingsPath, modelsJsonPath } from "../../modelConfig/paths";
import { attributeModelError } from "../../modelConfig/errors";
import type { RegistryProvider } from "../../modelConfig/types";

// ---------------------------------------------------------------------------
// ④ 适配器 · pi 引擎：pi（pi-agent-core / pi-ai）的全部使用收敛于此，实现 EngineFactory。
// 无状态：不持有 per-node 缓存；构建出的 EngineCacheEntry 由应用编排持有于
// NodeRuntime 记录上（session 再包装成 LlmEnginePort）。
// ② 不直接依赖 pi；分支上下文装配经 buildContext 回调转交 ① 领域核心。
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = "你是一个冷静、精确、克制的思考助手。回答直接，不啰嗦。";
const TRACE_TEXT_PREVIEW = 600;
const TRACE_MESSAGE_HEAD = 8;
const TRACE_MESSAGE_TAIL = 12;

function previewText(value: unknown, max = TRACE_TEXT_PREVIEW): string | undefined {
  if (typeof value === "string") return value.length <= max ? value : `${value.slice(0, max)}...`;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof (item as any).text === "string") return (item as any).text;
        if (item && typeof item === "object" && "type" in item) return `[${String((item as any).type)}]`;
        return "";
      })
      .filter(Boolean)
      .join("");
    return text.length <= max ? text : `${text.slice(0, max)}...`;
  }
  return undefined;
}

/** Bounded assistant output for the trace end event; TraceRepository applies its shared redaction sanitizer on write. */
export function summarizeAssistantResponse(message: unknown): { text: string; truncated: boolean } | undefined {
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
  const text = previewText(content);
  if (!text) return undefined;
  return { text, truncated: text.length > TRACE_TEXT_PREVIEW };
}

function summarizeMessage(message: unknown) {
  const msg = message as { role?: unknown; content?: unknown; usage?: unknown } | undefined;
  if (!msg || typeof msg !== "object") return { type: typeof message };
  const content = Array.isArray(msg.content) ? msg.content : undefined;
  return {
    role: typeof msg.role === "string" ? msg.role : undefined,
    text: previewText(msg.content),
    contentParts: content?.map((part) => typeof part === "object" && part ? (part as any).type ?? typeof part : typeof part),
    usage: msg.usage,
  };
}

function summarizeMessages(messages: unknown[]) {
  const omittedMiddle = Math.max(0, messages.length - TRACE_MESSAGE_HEAD - TRACE_MESSAGE_TAIL);
  const selected = omittedMiddle > 0
    ? [...messages.slice(0, TRACE_MESSAGE_HEAD), { role: "trace", content: `[${omittedMiddle} messages omitted]` }, ...messages.slice(-TRACE_MESSAGE_TAIL)]
    : messages;
  return selected.map(summarizeMessage);
}

export function modelsForSwitching(providers: RegistryProvider[]) {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.available && model.source !== "builtin")
      .map((model) => ({
        id: `${provider.id}/${model.id}`,
        name: model.name,
        providerId: provider.id,
        modelId: model.id,
        available: model.available,
        availability: model.availability,
        capabilities: model.capabilities,
      })),
  );
}

/** 已解析的模型配置（结构性契约，避免耦合 settings 的具体类型）。 */
export interface ResolvedModelConfig {
  providerId?: string;
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
  /** 当前节点项目根目录；用于读取项目 .loom/settings.json。 */
  getProjectRoot?: (nodeId: string) => string | undefined;
  /** hook 分发器：pi 的 before/afterToolCall/transformContext/事件转发至此。 */
  dispatcher: HookDispatcher;
  /** 当前节点活跃 outer turn id；仅用于把工具调用与应用 turn 相关联。 */
  getCurrentTurnId?: (nodeId: string) => string | undefined;
  /** trace 观测端口：pi 事件 → span（llm_call / tool）。 */
  trace?: TracePort;
}

export function createPiEngine(deps: PiEngineDeps): EngineFactory {
  const { events, resolveModel, buildContext, getNodeInit, getTools, getProjectRoot, dispatcher, getCurrentTurnId, trace } = deps;

  function fileStamp(filePath: string | undefined) {
    if (!filePath || !existsSync(filePath)) return `${filePath ?? ""}:missing`;
    const stat = statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  }

  function configStamp(nodeId?: string) {
    const home = homedir();
    const projectRoot = nodeId ? getProjectRoot?.(nodeId) : undefined;
    return [
      fileStamp(modelsJsonPath(home)),
      fileStamp(globalSettingsPath(home)),
      fileStamp(projectRoot ? join(projectRoot, ".loom", "settings.json") : undefined),
    ].join("|");
  }

  async function loadRegistryContext(nodeId?: string) {
    const registry = await ModelRegistry.load();
    const scoped = loadScopedModelSettings({ projectRoot: nodeId ? getProjectRoot?.(nodeId) : undefined });
    const models = await createRuntimeModelsFromRegistry(registry);
    return { registry, scoped, models, configStamp: configStamp(nodeId) };
  }

  // known 模型当接线模板；未知（自定义 endpoint）以其为壳改 id/baseUrl。
  async function buildModel(ctx: Awaited<ReturnType<typeof loadRegistryContext>>, selection?: StoredModelSelection) {
    const cfg = resolveModel();
    const parsed = parseStoredModelRef(selection);
    const migrated = parsed.kind === "legacy" ? migrateLegacyModelRef(parsed.legacyModel, ctx.registry) : undefined;
    const explicit = parsed.kind === "ref" ? parsed.ref : migrated?.kind === "ref" ? migrated.ref : undefined;
    const selected = resolveSelectedModel({ registry: ctx.registry, scoped: ctx.scoped, explicit });
    if (!selected.model || !selected.available) {
      const label = selected.ref.providerId && selected.ref.modelId ? `${selected.ref.providerId}/${selected.ref.modelId}` : cfg.model;
      throw attributeModelError(new Error(selected.diagnostic?.message || `模型不可用：${label}`), selected.ref);
    }
    const base = ctx.models.getModel(selected.ref.providerId, selected.ref.modelId);
    if (!base) throw attributeModelError(new Error(`未找到可用的模型模板（model=${selected.ref.providerId}/${selected.ref.modelId}）。`), selected.ref);
    const model = { ...base };
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

  function attributedStream(stream: any, ref: { providerId: string; modelId: string }) {
    return {
      ...stream,
      [Symbol.asyncIterator]() {
        const iterator = stream[Symbol.asyncIterator]();
        return {
          async next() {
            try {
              return await iterator.next();
            } catch (error) {
              throw attributeModelError(error, ref);
            }
          },
        };
      },
      result: async () => {
        try {
          return await stream.result();
        } catch (error) {
          throw attributeModelError(error, ref);
        }
      },
    };
  }

  async function build(nodeId: string): Promise<EngineCacheEntry> {
    const init = getNodeInit(nodeId);
    const [{ Agent }, modelContext] = await Promise.all([import("@earendil-works/pi-agent-core"), loadRegistryContext(nodeId)]);
    const model = await buildModel(modelContext, init?.model);
    // span 槽位：llm_call 的 parent（下一个 tool 用）+ tool 按 toolCallId 配对。
    let pendingLlmSpanId: string | undefined;
    const toolSpanByCallId = new Map<string, string>();
    const agent = new Agent({
      initialState: {
        systemPrompt: init?.systemPrompt || SYSTEM_PROMPT,
        model,
        thinkingLevel: init?.thinkingLevel,
        messages: [...(init?.messages ?? [])],
        tools: adaptAgentToolsToPi(getTools(nodeId)),
      },
      streamFn: (requestModel, context, options) => {
        const ref = { providerId: String(requestModel.provider), modelId: String(requestModel.id) };
        let llmSpanId: string | undefined;
        try {
          // llm_call span 进入：request payload（模型/系统提示/消息摘要/工具清单）作 attributes。
          llmSpanId = trace?.beginSpan({
            nodeId,
            kind: "llm_call",
            name: `${ref.providerId}/${ref.modelId}`,
            attributes: {
              model: { provider: ref.providerId, id: ref.modelId },
              systemPrompt: init?.systemPrompt || SYSTEM_PROMPT,
              messages: summarizeMessages(context.messages),
              messageCount: context.messages.length,
              tools: getTools(nodeId).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
              options,
            },
          });
        } catch (error) {
          // trace 是观测面：捕获失败绝不能让模型调用链丢失/中断。
          console.warn(`[trace] llm_call begin failed for ${nodeId}:`, error);
        }
        // 保留到 message_end 结束；下一次 streamFn 覆盖。工具 span 以此为 parent。
        pendingLlmSpanId = llmSpanId;
        try {
          return attributedStream(modelContext.models.streamSimple(requestModel, context, options), ref);
        } catch (error) {
          if (llmSpanId) trace?.endSpan(nodeId, llmSpanId, { status: "error" });
          pendingLlmSpanId = undefined;
          throw attributeModelError(error, ref);
        }
      },
      getApiKey: async () => modelContext.registry.requireProviderSecret(String(model.provider)).apiKey,
      // ★ 分支上下文引擎：本节点发消息前，委托 ① 核心装配上下文。
      convertToLlm: (own: AgentMessage[]) => buildContext(nodeId, own),
      // ★ Hook 扩展面（装一次即冻结）：pi 的钩子映射成中性上下文，转交分发器。
      //   空注册表下：transformContext 恒等、before/after 返回 undefined → 行为中性。
      transformContext: (messages: AgentMessage[]) => dispatcher.contextTransform(messages),
      beforeToolCall: async ({ toolCall, args }: BeforeToolCallContext) => {
        let spanId: string | undefined;
        try {
          spanId = trace?.beginSpan({
            nodeId,
            kind: "tool",
            name: toolCall.name,
            parentSpanId: pendingLlmSpanId,
            attributes: { arguments: args, id: toolCall.id },
          });
        } catch (error) {
          console.warn(`[trace] tool begin failed for ${nodeId}:`, error);
        }
        if (spanId) toolSpanByCallId.set(toolCall.id, spanId);
        const d = await dispatcher.toolCall({
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
        });
        return d ? { block: true, reason: d.reason } : undefined;
      },
      afterToolCall: ({ toolCall, args, result, isError }: AfterToolCallContext) => {
        const spanId = toolSpanByCallId.get(toolCall.id);
        toolSpanByCallId.delete(toolCall.id);
        if (spanId) {
          try {
            trace?.endSpan(nodeId, spanId, {
              status: isError ? "error" : "ok",
              attributes: { arguments: args, result: result.content, details: result.details, isError, usage: result.usage },
            });
          } catch (error) {
            console.warn(`[trace] tool end failed for ${nodeId}:`, error);
          }
        }
        return dispatcher.toolResult({
          nodeId,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
          content: result.content,
          details: result.details,
          isError,
          usage: result.usage,
        });
      },
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
          if (event.assistantMessageEvent?.type === "thinking_delta")
            events.emit(nodeId, "thinking_delta", event.assistantMessageEvent.delta);
          break;
        case "message_end":
          if (event.message?.role === "assistant") {
            // llm_call span 结束（streamFn 已 begin）；不清理 pendingLlmSpanId，
            // 让紧随的工具调用以它作 parent；下次 streamFn 会覆盖。
            if (pendingLlmSpanId) {
              const usage = (event.message as unknown as { usage?: unknown })?.usage;
              const response = summarizeAssistantResponse(event.message);
              try {
                trace?.endSpan(nodeId, pendingLlmSpanId, {
                  status: "ok",
                  attributes: { ...(usage ? { usage } : {}), ...(response ? { response } : {}) },
                });
              } catch (error) {
                console.warn(`[trace] llm_call end failed for ${nodeId}:`, error);
              }
            }
          }
          break;
        case "agent_end":
          events.emit(nodeId, "done");
          // 未结束的 span 由 finishTurn 兜底标 aborted；清空槽位。
          pendingLlmSpanId = undefined;
          toolSpanByCallId.clear();
          break;
      }
      // Hook 观测面：把每个 pi 事件广播给已注册 hook（H1 工具时间线等）。
      dispatcher.event(nodeId, event);
    });

    const handle = wrap(agent);
    return { agent, handle, configStamp: modelContext.configStamp };
  }

  return {
    build,
    configStamp,
    async listModels() {
      const { registry } = await loadRegistryContext();
      return modelsForSwitching(registry.listProviders());
    },
  };
}
