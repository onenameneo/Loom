import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LoomUiMessage } from "./messages";
import { buildContextPlan, isLlmMessage, roleOf, textOf } from "./context";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const asst = (text: string): AgentMessage =>
  ({ role: "assistant", content: [{ type: "text", text }], timestamp: 0 }) as AgentMessage;
const uiOnly = (): LoomUiMessage => ({ role: "loomUi", kind: "chip", content: "chip", timestamp: 0 });

describe("roleOf / textOf / isLlmMessage", () => {
  it("reads role, defaulting non-string to custom", () => {
    expect(roleOf(user("hi"))).toBe("user");
    expect(roleOf({ content: "x" } as AgentMessage)).toBe("custom");
  });
  it("extracts text from string and block content", () => {
    expect(textOf(user("hello"))).toBe("hello");
    expect(textOf(asst("world"))).toBe("world");
  });
  it("classifies only user/assistant/toolResult as LLM messages", () => {
    expect(isLlmMessage(user("a"))).toBe(true);
    expect(isLlmMessage(asst("b"))).toBe(true);
    expect(isLlmMessage(uiOnly())).toBe(false);
  });
});

describe("buildContextPlan", () => {
  const own = [user("我的问题"), uiOnly(), asst("我的回答")];

  it("passes through own LLM messages and filters UI-only", () => {
    const plan = buildContextPlan({ mountAncestors: false }, own);
    expect(plan.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("prepends seed message above own messages when seed present", () => {
    const seed = { text: "片段", from: "n1", parent: "n0" };
    const plan = buildContextPlan({ mountAncestors: false, seed }, own);
    expect(plan[0].role).toBe("user");
    expect(String(plan[0].content)).toContain("片段");
    // seed 之后才是本节点消息
    expect(plan.slice(1).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("omits ancestors when mountAncestors is false", () => {
    const plan = buildContextPlan({ mountAncestors: false, forkContextSnapshot: [user("祖先问"), asst("祖先答")] as any }, own);
    expect(plan.length).toBe(2);
  });

  it("prepends ancestor conversation when mountAncestors is true", () => {
    const plan = buildContextPlan({ mountAncestors: true, forkContextSnapshot: [user("祖先问"), asst("祖先答")] as any }, own);
    // 祖先(user,assistant) → 本节点(user,assistant)
    expect(plan.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(String(plan[0].content)).toBe("祖先问");
  });

  it("orders ancestors → seed → own", () => {
    const seed = { text: "片段", from: "n1", parent: "n0" };
    const plan = buildContextPlan({ mountAncestors: true, seed, forkContextSnapshot: [user("祖先问")] as any }, own);
    expect(String(plan[0].content)).toBe("祖先问");
    expect(String(plan[1].content)).toContain("片段");
    expect(plan[2].role).toBe("user");
  });

  it("inserts tail context before the active final user message", () => {
    const tail = [{ role: "user", content: "[skill context]", timestamp: 0 } as any];
    const plan = buildContextPlan({ mountAncestors: false }, [user("history"), asst("answer"), user("next")], 0, tail);
    expect(plan.map((m) => [m.role, typeof m.content === "string" ? m.content : textOf(m as any)])).toEqual([
      ["user", "history"],
      ["assistant", "answer"],
      ["user", "[skill context]"],
      ["user", "next"],
    ]);
  });

  it("does not insert tail context between an assistant tool call and its tool result", () => {
    const assistantWithToolCall = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      toolCalls: [{ id: "call-1", name: "skill_read", args: { skillId: "research" } }],
      timestamp: 0,
    } as unknown as AgentMessage;
    const toolResult = {
      role: "toolResult",
      toolName: "skill_read",
      toolCallId: "call-1",
      content: [{ type: "text", text: "skill body" }],
      timestamp: 0,
    } as unknown as AgentMessage;
    const tail = [{ role: "user", content: "[skill context]", timestamp: 0 } as any];
    const plan = buildContextPlan({ mountAncestors: false }, [user("next"), assistantWithToolCall, toolResult], 0, tail);

    expect(plan.map((m) => [m.role, textOf(m as any)])).toEqual([
      ["user", "next"],
      ["assistant", ""],
      ["toolResult", "skill body"],
    ]);
  });
});
