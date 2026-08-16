import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LoomUiMessage } from "./messages";
import { createLoomContextCheckpoint } from "./messages";
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
  it("keeps assistant thinking separate from visible text", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private chain" },
        { type: "text", text: "visible answer" },
      ],
      timestamp: 0,
    } as unknown as AgentMessage;

    expect(textOf(msg)).toBe("visible answer");
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
    const plan = buildContextPlan({}, own);
    expect(plan.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("prepends seed message above own messages when seed present", () => {
    const seed = { text: "片段", from: "n1", parent: "n0" };
    const plan = buildContextPlan({ seed }, own);
    expect(plan[0].role).toBe("user");
    expect(String(plan[0].content)).toContain("片段");
    // seed 之后才是本节点消息
    expect(plan.slice(1).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("prepends frozen context regardless of legacy mount flag", () => {
    const plan = buildContextPlan({ frozenContext: { version: 1, messages: [user("父问"), asst("父答")] as any } }, own);
    expect(plan.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(String(plan[0].content)).toBe("父问");
  });

  it("orders frozen context → seed → checkpoint projection → own", () => {
    const seed = { text: "片段", from: "n1", parent: "n0" };
    const plan = buildContextPlan({ seed, frozenContext: { version: 1, messages: [user("父问")] as any } }, own);
    expect(String(plan[0].content)).toBe("父问");
    expect(String(plan[1].content)).toContain("片段");
    expect(plan[2].role).toBe("user");
  });

  it("inserts tail context before the active final user message", () => {
    const tail = [{ role: "user", content: "[skill context]", timestamp: 0 } as any];
    const plan = buildContextPlan({}, [user("history"), asst("answer"), user("next")], 0, tail);
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
    const plan = buildContextPlan({}, [user("next"), assistantWithToolCall, toolResult], 0, tail);

    expect(plan.map((m) => [m.role, textOf(m as any)])).toEqual([
      ["user", "next"],
      ["assistant", ""],
      ["toolResult", "skill body"],
    ]);
  });

  it("projects the newest valid checkpoint and only uncovered source tail without mutating transcript", () => {
    const older = createLoomContextCheckpoint({
      id: "cp-old",
      nodeId: "n1",
      createdAt: 1,
      reason: "threshold",
      summary: "old summary",
      coverage: { fromSeq: 0, toSeq: 1 },
      retainedTail: { fromSeq: 2, toSeq: 3 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 50, exact: true } },
    }) as any;
    const newer = createLoomContextCheckpoint({
      id: "cp-new",
      nodeId: "n1",
      createdAt: 2,
      reason: "manual",
      summary: "new summary",
      coverage: { fromSeq: 0, toSeq: 4 },
      retainedTail: { fromSeq: 5, toSeq: 6 },
      diagnostics: { before: { tokens: 120, exact: false }, after: { tokens: 40, exact: false } },
    }) as any;
    const transcript = [user("u1"), asst("a1"), older, user("u2"), asst("a2"), newer, user("tail")];

    const plan = buildContextPlan({}, transcript);

    expect(transcript).toHaveLength(7);
    expect(plan.map((m) => [m.role, textOf(m as any)])).toEqual([
      ["user", expect.stringContaining("new summary")],
      ["user", "tail"],
    ]);
    expect(textOf(plan[0] as any)).not.toContain("old summary");
  });

  it("projects checkpoint summary before attachments and uncovered source messages", () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1", nodeId: "n1", createdAt: 1, reason: "threshold", summary: "old summary",
      coverage: { fromSeq: 0, toSeq: 0 }, retainedTail: { fromSeq: 1, toSeq: 2 },
      diagnostics: { before: { tokens: 10, exact: false }, after: { tokens: 5, exact: false } },
      attachments: [{
        version: 1, kind: "file-context", id: "file:src/app.ts",
        source: { identity: "file:src/app.ts", path: "src/app.ts" }, text: "file context",
        tokens: { tokens: 2, exact: false },
      }],
    });
    const toolCall = { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "search", args: {} }], timestamp: 0 } as any;
    const toolResult = { role: "toolResult", toolCallId: "call-1", toolName: "search", content: "result", timestamp: 0 } as any;
    const plan = buildContextPlan({}, [checkpoint as any, toolCall, toolResult, user("next")] as any, 7);

    expect(plan.map((message) => textOf(message as any))).toEqual([
      expect.stringContaining("old summary"),
      expect.stringContaining("file context"),
      "",
      "result",
      "next",
    ]);
    expect(plan[1]?.role).toBe("user");
    expect(plan[2]?.role).toBe("assistant");
    expect(plan[3]?.role).toBe("toolResult");
  });

  it("accepts legacy checkpoints without attachments and ignores unknown attachment kinds", () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-legacy", nodeId: "n1", createdAt: 1, reason: "manual", summary: "legacy",
      coverage: { fromSeq: 0, toSeq: 0 }, retainedTail: { fromSeq: 1, toSeq: 1 },
      diagnostics: { before: { tokens: 2, exact: false }, after: { tokens: 1, exact: false } },
      attachments: [{
        version: 1, kind: "future-kind", id: "future", source: { identity: "future" }, text: "ignore", tokens: { tokens: 1, exact: false },
      } as any],
    });
    expect(buildContextPlan({}, [checkpoint as any, user("tail")] as any).map((message) => textOf(message as any))).toEqual([
      expect.stringContaining("legacy"), "tail",
    ]);
  });

  it("does not restore an oversized persisted attachment", () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-large", nodeId: "n1", createdAt: 1, reason: "manual", summary: "summary",
      coverage: { fromSeq: 0, toSeq: 0 }, retainedTail: { fromSeq: 1, toSeq: 1 },
      diagnostics: { before: { tokens: 2, exact: false }, after: { tokens: 1, exact: false } },
      attachments: [{
        version: 1, kind: "file-context", id: "large", source: { identity: "large" }, text: "x".repeat(20_000),
        tokens: { tokens: 1, exact: true },
      }],
    });

    const plan = buildContextPlan({}, [checkpoint as any, user("tail")] as any);
    expect(plan.map((message) => textOf(message as any))).toEqual([
      expect.stringContaining("summary"), "tail",
    ]);
  });
});
