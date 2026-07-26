import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, Usage } from "@earendil-works/pi-ai";
import type { Store } from "../store/store";

// ---------------------------------------------------------------------------
// ③ 端口（契约）：由内圈（②应用编排）声明、外圈（④适配器）实现。
// ② 只依赖这些 interface，不认具体设施（pi / sqlite / electron）。
//
// 本次（H0）只建 canvas 现有职责用到的最小集。H1+ 预留（本次不实现）：
//   HttpPort（web 工具）· ApprovalPort（beforeToolCall 批准门）·
//   FsPort / ShellPort（副作用工具）· MemoryPort（gbrain 召回）。
// ---------------------------------------------------------------------------

/** 引擎按创建时机需要的节点初值（系统提示 / 模型 / 初始转写）。 */
export interface NodeInit {
  systemPrompt?: string;
  model?: string;
  messages: AgentMessage[];
}

/** 单个节点的 LLM 引擎句柄——屏蔽 pi.Agent，向 ② 暴露稳定接口。 */
export interface EngineHandle {
  prompt(msg: AgentMessage): Promise<void>;
  continue(): Promise<void>;
  abort(): void;
  reset(): void;
  /** 引擎当前的转写（供 ② 取发送后的增量消息）。 */
  readonly messages: AgentMessage[];
  /** 用给定转写覆盖引擎消息（截断/编辑重发后同步）。 */
  syncMessages(msgs: AgentMessage[]): void;
}

export type TurnOperationKind = "send" | "regenerate" | "edit-resend";
export type TurnState = "idle" | "running" | "awaiting_approval" | "completed" | "aborted" | "failed";
export type TurnFailureReason = "node_busy" | "failed" | "aborted" | "stale";
export type TurnResult = { ok: true; turnId: string } | { ok: false; reason: TurnFailureReason; turnId?: string };

export interface TurnLifecycleEvent {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: Exclude<TurnState, "idle">;
  error?: string;
  approval?: {
    requestId: string;
    toolName: string;
    toolCallId: string;
  };
}

export interface TurnRunContext {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  signal: AbortSignal;
  setAbortHandle(handle: Pick<EngineHandle, "abort"> | undefined): void;
  setAwaitingApproval(approval?: TurnLifecycleEvent["approval"]): boolean;
  setRunning(): boolean;
  isStale(): boolean;
}

/** QueryEngine 对引擎的一次调用；pi 内部仍自行完成模型/工具迭代。 */
export type QueryInvocation =
  | { kind: "prompt"; message: AgentMessage; from?: number }
  | { kind: "continue"; from?: number };

/** 应用层 QueryEngine 的节点查询请求。转写操作由 session 注入，生命周期由 QueryEngine 持有。 */
export interface NodeQueryRequest {
  nodeId: string;
  operation: TurnOperationKind;
  prepare(handle: EngineHandle): QueryInvocation | Promise<QueryInvocation>;
  finalize(handle: EngineHandle, from: number): void | Promise<void>;
}

export interface NodeQueryResult {
  result: TurnResult;
  error?: unknown;
}

/** LLM 引擎端口：惰性按 nodeId 创建/缓存引擎，屏蔽 pi。 */
export interface LlmEnginePort {
  /** 惰性拿到/创建某节点的引擎（装好 convertToLlm 与事件转发）。 */
  ensure(nodeId: string): Promise<EngineHandle>;
  /** 取已存在的引擎（不创建）——用于 abort/reset 等不应触发创建的操作。 */
  peek(nodeId: string): EngineHandle | undefined;
  /** 失效单个引擎（删节点 / 改 systemPrompt / 改 model 后）。 */
  drop(nodeId: string): void;
  /** 失效所有引擎（设置变更后按新配置重建）。 */
  invalidateAll(): void;
  /** 可选模型列表（provider 注册表）。 */
  listModels(): Promise<Array<{ id: string; name: string }>>;
}

/** 事件汇：把引擎/编排事件推给 renderer。 */
export interface EventSinkPort {
  emit(nodeId: string, type: string, payload?: unknown): void;
}

/** 持久化端口——现有 Store 接口即契约本身。 */
export type StorePort = Store;

/** 时钟端口（抽出 Date.now，利于测试/重放）。 */
export interface ClockPort {
  now(): number;
}

/** id 生成端口（抽出自增序列与时间戳编码）。 */
export interface IdPort {
  /** 消息 id（等价原 nextMessageId）。 */
  message(): string;
}

// ---------------------------------------------------------------------------
// Hook 扩展面（agent-hook-substrate / H0.5）：一套规范的可组合钩子。
// pi 的 beforeToolCall / afterToolCall / transformContext / 事件在 ④ 引擎装一次，
// 转发给 HookDispatcher；能力（H1+）只 registerHook，永不再改引擎。
// 契约用中性上下文，不泄漏 pi 值（pi 类型仅 import type）。
// ---------------------------------------------------------------------------

/** 工具调用前的中性上下文（映射自 pi BeforeToolCallContext）。 */
export interface HookToolCallContext {
  nodeId: string;
  turnId?: string;
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export type ApprovalScope = "once" | "node-session" | "persistent";

export interface ToolApprovalRequirement {
  required: true;
  defaultScope?: ApprovalScope;
  target: string;
  preview: {
    title: string;
    description?: string;
    args?: unknown;
  };
}

export type ApprovalDecision = {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  action: "allow" | "deny";
  scope?: ApprovalScope;
};

export interface ApprovalRequest {
  requestId: string;
  nodeId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  target: string;
  preview: ToolApprovalRequirement["preview"];
  defaultScope: ApprovalScope;
  createdAt: number;
  expiresAt: number;
}

export type PendingApprovalDecision = Promise<ApprovalDecision> & { requestId: string };

export interface ApprovalPort {
  request(input: Omit<ApprovalRequest, "requestId" | "createdAt" | "expiresAt">): PendingApprovalDecision;
  decide(decision: ApprovalDecision): { ok: boolean; reason?: "not_found" | "stale" | "mismatch" };
  cancelByTurn(nodeId: string, turnId: string, reason: string): void;
  cancelByNode(nodeId: string, reason: string): void;
}

/** 阻止工具执行的决策（→ pi BeforeToolCallResult）。 */
export interface BlockDecision {
  block: true;
  reason?: string;
}

/** 工具结果的中性上下文（映射自 pi AfterToolCallContext）。 */
export interface HookToolResultContext extends HookToolCallContext {
  content: (TextContent | ImageContent)[];
  details: unknown;
  isError: boolean;
  usage?: Usage;
}

/** 对工具结果的部分覆写（→ pi AfterToolCallResult，逐字段替换，无深合并）。 */
export interface ResultOverride {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  usage?: Usage;
  terminate?: boolean;
}

/** 一个可注册的钩子：四个可选点，能力按需实现其一或多个。 */
export interface AgentHook {
  name: string;
  /** 工具执行前：返回 BlockDecision 拦截（拒绝优先短路）。 */
  onToolCall?(ctx: HookToolCallContext): BlockDecision | void | Promise<BlockDecision | void>;
  /** 工具执行后：返回 ResultOverride 改写（链式合并）。 */
  onToolResult?(ctx: HookToolResultContext): ResultOverride | void | Promise<ResultOverride | void>;
  /** LLM 调用前：变换 AgentMessage[]（顺序组合，用于压缩/记忆注入）。 */
  onContextTransform?(messages: AgentMessage[]): AgentMessage[] | Promise<AgentMessage[]>;
  /** 观测 pi 事件（只读广播，用于工具时间线等 UI）。 */
  onEvent?(nodeId: string, event: AgentEvent): void;
}

/** 引擎适配器（④）调用的分发面——由 ② 注册表实现。 */
export interface HookDispatcher {
  toolCall(ctx: HookToolCallContext): Promise<BlockDecision | undefined>;
  toolResult(ctx: HookToolResultContext): Promise<ResultOverride | undefined>;
  contextTransform(messages: AgentMessage[]): Promise<AgentMessage[]>;
  event(nodeId: string, event: AgentEvent): void;
}
