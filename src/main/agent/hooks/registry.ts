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
// ---------------------------------------------------------------------------

export type HookRegistry = HookDispatcher & {
  use(hook: AgentHook): void;
  readonly hooks: readonly AgentHook[];
};

function mergeOverride(prev: ResultOverride | undefined, next: ResultOverride): ResultOverride {
  const out: ResultOverride = { ...prev };
  if (next.content !== undefined) out.content = next.content;
  if ("details" in next) out.details = next.details;
  if (next.isError !== undefined) out.isError = next.isError;
  if (next.usage !== undefined) out.usage = next.usage;
  if (next.terminate !== undefined) out.terminate = next.terminate;
  return out;
}

function applyOverride(ctx: HookToolResultContext, o: ResultOverride | undefined): HookToolResultContext {
  if (!o) return ctx;
  return {
    ...ctx,
    content: o.content !== undefined ? o.content : ctx.content,
    details: "details" in o ? o.details : ctx.details,
    isError: o.isError !== undefined ? o.isError : ctx.isError,
    usage: o.usage !== undefined ? o.usage : ctx.usage,
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
