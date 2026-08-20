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
import type { EngineCacheEntry, EngineFactory, EngineHandle, EventSinkPort, HookDispatcher, NodeInit } from "../ports";
import { adaptAgentToolsToPi } from "./piTools";
import type { StoredModelSelection } from "../../modelConfig/modelRef";
import { ModelRegistry } from "../../modelConfig/registry";
import { createRuntimeModelsFromRegistry } from "../../modelConfig/runtimeModels";
import { loadScopedModelSettings, resolveStoredModelSelection } from "../../modelConfig/scopes";
import { globalSettingsPath, modelsJsonPath } from "../../modelConfig/paths";
import { attributeModelError } from "../../modelConfig/errors";
import type { RegistryProvider } from "../../modelConfig/types";
import { normalizeLlmUsage } from "../core/usage";
import { defaultSystemPrompt, type SystemPromptLocale } from "../../../common/systemPrompt";

// ---------------------------------------------------------------------------
// ④ 适配器 · pi 引擎：pi（pi-agent-core / pi-ai）的全部使用收敛于此，实现 EngineFactory。
// 无状态：不持有 per-node 缓存；构建出的 EngineCacheEntry 由应用编排持有于
// NodeRuntime 记录上（session 再包装成 LlmEnginePort）。
// ② 不直接依赖 pi；分支上下文装配经 buildContext 回调转交 ① 领域核心。
// ---------------------------------------------------------------------------

const TRACE_TEXT_PREVIEW = 600;
const TRACE_MESSAGE_HEAD = 8;
const TRACE_MESSAGE_TAIL = 12;
const MAX_ENDED_LLM_REQUESTS = 128;

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
  /** Current UI locale, used when a node has no custom system prompt. */
  getLocale?: () => SystemPromptLocale;
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
}

export function createPiEngine(deps: PiEngineDeps): EngineFactory {
  const { events, resolveModel, getLocale, buildContext, getNodeInit, getTools, getProjectRoot, dispatcher, getCurrentTurnId } = deps;

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
    const selected = resolveStoredModelSelection({ registry: ctx.registry, scoped: ctx.scoped, explicit: selection });
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
      setSystemPrompt: (prompt) => {
        agent.state.systemPrompt = prompt;
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
    let requestSeq = 0;
    let activeLlmRequestId: string | undefined;
    let latestLlmRequestId: string | undefined;
    const llmStartedAt = new Map<string, number>();
    const llmFirstTokenAt = new Map<string, number>();
    const toolStartedAt = new Map<string, number>();
    const endedLlmRequests = new Set<string>();
    const now = () => Date.now();
    const endLlm = (requestId: string, message: unknown, status: "ok" | "error" | "aborted") => {
      if (endedLlmRequests.has(requestId)) return;
      endedLlmRequests.add(requestId);
      while (endedLlmRequests.size > MAX_ENDED_LLM_REQUESTS) {
        const oldest = endedLlmRequests.values().next().value;
        if (typeof oldest !== "string") break;
        endedLlmRequests.delete(oldest);
      }
      const startedAt = llmStartedAt.get(requestId);
      const firstTokenAt = llmFirstTokenAt.get(requestId);
      const usage = normalizeLlmUsage((message as { usage?: unknown } | undefined)?.usage, { source: "provider", exact: true });
      const response = summarizeAssistantResponse(message);
      dispatcher.telemetry({
        type: "llm_end",
        nodeId,
        turnId: getCurrentTurnId?.(nodeId),
        requestId,
        providerId: String((message as { provider?: unknown } | undefined)?.provider ?? ""),
        modelId: String((message as { model?: unknown } | undefined)?.model ?? ""),
        status,
        at: now(),
        ...(startedAt !== undefined ? { durationMs: Math.max(0, now() - startedAt) } : {}),
        ...(firstTokenAt !== undefined && startedAt !== undefined ? { ttftMs: Math.max(0, firstTokenAt - startedAt) } : {}),
        ...(usage ? { usage } : {}),
        ...(response ? { attributes: { response } } : {}),
      });
      llmStartedAt.delete(requestId);
      llmFirstTokenAt.delete(requestId);
      if (activeLlmRequestId === requestId) activeLlmRequestId = undefined;
    };
    const agent = new Agent({
      initialState: {
        systemPrompt: init?.systemPrompt || defaultSystemPrompt(getLocale?.()),
        model,
        thinkingLevel: init?.thinkingLevel,
        messages: [...(init?.messages ?? [])],
        tools: adaptAgentToolsToPi(getTools(nodeId)),
      },
      streamFn: (requestModel, context, options) => {
        const ref = { providerId: String(requestModel.provider), modelId: String(requestModel.id) };
        const requestId = `${nodeId}:llm:${++requestSeq}`;
        const startedAt = now();
        activeLlmRequestId = requestId;
        latestLlmRequestId = requestId;
        llmStartedAt.set(requestId, startedAt);
        dispatcher.telemetry({
          type: "llm_start",
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          requestId,
          providerId: ref.providerId,
          modelId: ref.modelId,
          at: startedAt,
          attributes: {
            model: { provider: ref.providerId, id: ref.modelId },
            systemPrompt: init?.systemPrompt || defaultSystemPrompt(getLocale?.()),
            messages: summarizeMessages(context.messages),
            messageCount: context.messages.length,
            tools: getTools(nodeId).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
            options,
          },
        });
        try {
          return attributedStream(modelContext.models.streamSimple(requestModel, context, options), ref);
        } catch (error) {
          endLlm(requestId, { provider: ref.providerId, model: ref.modelId }, "error");
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
        const startedAt = now();
        toolStartedAt.set(toolCall.id, startedAt);
        dispatcher.telemetry({
          type: "tool_start",
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          parentRequestId: latestLlmRequestId,
          at: startedAt,
          attributes: { arguments: args, id: toolCall.id },
        });
        const d = await dispatcher.toolCall({
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          args,
        });
        if (d) {
          toolStartedAt.delete(toolCall.id);
          dispatcher.telemetry({
            type: "tool_end",
            nodeId,
            turnId: getCurrentTurnId?.(nodeId),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            status: "error",
            at: now(),
            durationMs: Math.max(0, now() - startedAt),
            attributes: { reason: d.reason, blocked: true },
          });
          return { block: true, reason: d.reason };
        }
        return undefined;
      },
      afterToolCall: ({ toolCall, args, result, isError }: AfterToolCallContext) => {
        const startedAt = toolStartedAt.get(toolCall.id);
        toolStartedAt.delete(toolCall.id);
        const usage = normalizeLlmUsage(result.usage, { source: "provider", exact: true });
        dispatcher.telemetry({
          type: "tool_end",
          nodeId,
          turnId: getCurrentTurnId?.(nodeId),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          status: isError ? "error" : "ok",
          at: now(),
          ...(startedAt !== undefined ? { durationMs: Math.max(0, now() - startedAt) } : {}),
          ...(usage ? { usage } : {}),
          attributes: { arguments: args, result: result.content, details: result.details, isError },
        });
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
          if (activeLlmRequestId && !endedLlmRequests.has(activeLlmRequestId) && (event.assistantMessageEvent?.type === "text_delta" || event.assistantMessageEvent?.type === "thinking_delta" || event.assistantMessageEvent?.type === "toolcall_delta")) {
            const firstTokenAt = now();
            if (!llmFirstTokenAt.has(activeLlmRequestId)) {
              llmFirstTokenAt.set(activeLlmRequestId, firstTokenAt);
              const startedAt = llmStartedAt.get(activeLlmRequestId);
              dispatcher.telemetry({ type: "llm_first_token", nodeId, turnId: getCurrentTurnId?.(nodeId), requestId: activeLlmRequestId, at: firstTokenAt, ...(startedAt !== undefined ? { ttftMs: Math.max(0, firstTokenAt - startedAt) } : {}) });
            }
          }
          if (event.assistantMessageEvent?.type === "text_delta")
            events.emit(nodeId, "delta", event.assistantMessageEvent.delta);
          if (event.assistantMessageEvent?.type === "thinking_delta")
            events.emit(nodeId, "thinking_delta", event.assistantMessageEvent.delta);
          break;
        case "message_end":
          if (event.message?.role === "assistant") {
            if (activeLlmRequestId) {
              const stopReason = String((event.message as any).stopReason ?? "stop");
              endLlm(activeLlmRequestId, event.message, stopReason === "aborted" ? "aborted" : stopReason === "error" ? "error" : "ok");
            }
          }
          break;
        case "agent_end":
          events.emit(nodeId, "done");
          if (activeLlmRequestId) endLlm(activeLlmRequestId, { provider: "", model: "" }, "aborted");
          activeLlmRequestId = undefined;
          toolStartedAt.clear();
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
