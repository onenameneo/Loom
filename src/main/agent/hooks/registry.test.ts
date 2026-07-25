import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createHookRegistry } from "./registry";
import type { AgentHook, HookToolCallContext, HookToolResultContext } from "../ports";

const callCtx: HookToolCallContext = { nodeId: "n1", toolName: "bash", toolCallId: "t1", args: { cmd: "ls" } };
const resultCtx: HookToolResultContext = {
  ...callCtx,
  content: [{ type: "text", text: "raw" }],
  details: undefined,
  isError: false,
  usage: {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
const msg = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const evt: AgentEvent = { type: "agent_start" };

describe("createHookRegistry · toolCall（拒绝优先短路）", () => {
  it("第一个 {block} 生效，其余 onToolCall 不再调", async () => {
    const r = createHookRegistry();
    const later = vi.fn();
    r.use({ name: "allow", onToolCall: () => undefined });
    r.use({ name: "deny", onToolCall: () => ({ block: true as const, reason: "禁止" }) });
    r.use({ name: "never", onToolCall: later });
    const d = await r.toolCall(callCtx);
    expect(d).toEqual({ block: true, reason: "禁止" });
    expect(later).not.toHaveBeenCalled();
  });

  it("无一拦截 → undefined", async () => {
    const r = createHookRegistry();
    r.use({ name: "a", onToolCall: () => undefined });
    expect(await r.toolCall(callCtx)).toBeUndefined();
  });
});

describe("createHookRegistry · toolResult（链式合并）", () => {
  it("两个 hook 依次改写，后者见到前者覆盖，字段逐个合并", async () => {
    const r = createHookRegistry();
    const seen: string[] = [];
    r.use({
      name: "redact",
      onToolResult: (ctx) => {
        seen.push((ctx.content[0] as any).text);
        return { content: [{ type: "text", text: "REDACTED" }] };
      },
    });
    r.use({
      name: "flag",
      onToolResult: (ctx) => {
        seen.push((ctx.content[0] as any).text);
        return {
          isError: true,
          usage: {
            input: 5,
            output: 6,
            cacheRead: 7,
            cacheWrite: 8,
            totalTokens: 11,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
      },
    });
    const o = await r.toolResult(resultCtx);
    expect(seen).toEqual(["raw", "REDACTED"]);
    expect(o).toEqual({
      content: [{ type: "text", text: "REDACTED" }],
      isError: true,
      usage: {
        input: 5,
        output: 6,
        cacheRead: 7,
        cacheWrite: 8,
        totalTokens: 11,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
  });
});

describe("createHookRegistry · contextTransform（顺序组合）", () => {
  it("前者输出喂后者", async () => {
    const r = createHookRegistry();
    r.use({ name: "add-a", onContextTransform: (m) => [...m, msg("A")] });
    r.use({ name: "add-b", onContextTransform: (m) => [...m, msg("B")] });
    const out = await r.contextTransform([msg("start")]);
    expect(out.map((m) => (m as any).content)).toEqual(["start", "A", "B"]);
  });
});

describe("createHookRegistry · event（广播 + 异常隔离）", () => {
  it("广播到所有 hook；某 hook 抛错不影响其它", () => {
    const r = createHookRegistry();
    const good = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    r.use({ name: "boom", onEvent: () => { throw new Error("x"); } });
    r.use({ name: "ok", onEvent: good });
    expect(() => r.event("n1", evt)).not.toThrow();
    expect(good).toHaveBeenCalledWith("n1", evt);
    spy.mockRestore();
  });
});

describe("createHookRegistry · 空注册表行为保真", () => {
  it("contextTransform 返回同一引用/同序同内容", async () => {
    const r = createHookRegistry();
    const input = [msg("a"), msg("b")];
    const out = await r.contextTransform(input);
    expect(out).toBe(input);
  });

  it("toolCall / toolResult 返回 undefined", async () => {
    const r = createHookRegistry();
    expect(await r.toolCall(callCtx)).toBeUndefined();
    expect(await r.toolResult(resultCtx)).toBeUndefined();
  });
});

const _partial: AgentHook = { name: "partial", onEvent: () => {} };
void _partial;
