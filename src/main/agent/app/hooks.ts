import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentHook,
  HookDispatcher,
  HookToolCallContext,
  HookToolResultContext,
  ResultOverride,
} from "../ports";

// ---------------------------------------------------------------------------
// ② 应用编排 · Hook 注册表：按规范的中间件语义折叠已注册钩子，实现 HookDispatcher。
// 纯 TS（只 import type 引 pi），可脱离 Electron 单测。空注册表 = 行为中性。
//
//   onToolCall        拒绝优先短路：第一个 {block} 生效，其余不再调
//   onToolResult      链式合并：逐字段覆写，后一个 hook 见到已累积覆盖
//   onContextTransform 顺序组合：前者输出喂后者
//   onEvent           广播：只读，单个 hook 抛错被隔离
// ---------------------------------------------------------------------------

export type HookRegistry = HookDispatcher & {
  use(hook: AgentHook): void;
  readonly hooks: readonly AgentHook[];
};

/** 把 next 的已提供字段覆写到 prev 上（无深合并，与 pi AfterToolCallResult 语义一致）。 */
function mergeOverride(prev: ResultOverride | undefined, next: ResultOverride): ResultOverride {
  const out: ResultOverride = { ...prev };
  if (next.content !== undefined) out.content = next.content;
  if ("details" in next) out.details = next.details;
  if (next.isError !== undefined) out.isError = next.isError;
  if (next.terminate !== undefined) out.terminate = next.terminate;
  return out;
}

/** 把已累积覆盖应用到结果上下文，供链条中下一个 hook 看到最新值。 */
function applyOverride(ctx: HookToolResultContext, o: ResultOverride | undefined): HookToolResultContext {
  if (!o) return ctx;
  return {
    ...ctx,
    content: o.content !== undefined ? o.content : ctx.content,
    details: "details" in o ? o.details : ctx.details,
    isError: o.isError !== undefined ? o.isError : ctx.isError,
  };
}

export function createHookRegistry(): HookRegistry {
  const hooks: AgentHook[] = [];

  return {
    hooks,
    use(hook: AgentHook) {
      hooks.push(hook);
    },

    async toolCall(ctx: HookToolCallContext) {
      for (const h of hooks) {
        const d = await h.onToolCall?.(ctx);
        if (d?.block) return d;
      }
      return undefined;
    },

    async toolResult(ctx: HookToolResultContext) {
      let override: ResultOverride | undefined;
      for (const h of hooks) {
        const o = await h.onToolResult?.(applyOverride(ctx, override));
        if (o) override = mergeOverride(override, o);
      }
      return override;
    },

    async contextTransform(messages: AgentMessage[]) {
      let msgs = messages;
      for (const h of hooks) {
        if (h.onContextTransform) msgs = await h.onContextTransform(msgs);
      }
      return msgs;
    },

    event(nodeId: string, event: AgentEvent) {
      for (const h of hooks) {
        if (!h.onEvent) continue;
        try {
          h.onEvent(nodeId, event);
        } catch (err) {
          console.error(`[hook:${h.name}] onEvent failed`, err);
        }
      }
    },
  };
}
