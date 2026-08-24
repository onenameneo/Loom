import { describe, expect, it } from "vitest";
import {
  applyToolEvent,
  clearToolTimeline,
  groupToolTimelineMessages,
  isToolCanvasEventPayload,
  upsertToolTimelineMessage,
  type ToolTimelineMessage,
} from "./toolTimeline";

describe("tool timeline state", () => {
  it("creates and updates a tool call by id", () => {
    const started = applyToolEvent([], { state: "start", toolCallId: "tc-1", toolName: "calc" }, 10);
    expect(started).toMatchObject([{ id: "tc-1", name: "calc", state: "start", startedAt: 10, updatedAt: 10 }]);

    const ended = applyToolEvent(started, {
      state: "end",
      toolCallId: "tc-1",
      toolName: "calc",
      summary: "2",
    }, 20);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: "tc-1", state: "end", summary: "2", startedAt: 10, updatedAt: 20 });
  });

  it("keeps the final bounded error details on the same tool row", () => {
    const started = applyToolEvent([], { state: "start", toolCallId: "tc-error", toolName: "run_command" }, 10);
    const ended = applyToolEvent(started, {
      state: "end",
      toolCallId: "tc-error",
      toolName: "run_command",
      isError: true,
      summary: "Command failed with exit code 2",
      details: { json: '{"exitCode":2,"cwd":"/tmp"}', truncated: false },
    }, 20);

    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: "tc-error", state: "end", isError: true, details: { truncated: false } });
    expect(ended[0].details).toEqual({ json: '{"exitCode":2,"cwd":"/tmp"}', truncated: false });
  });

  it("narrows valid payloads", () => {
    expect(isToolCanvasEventPayload({ state: "start", toolCallId: "tc", toolName: "now" })).toBe(true);
    expect(isToolCanvasEventPayload({ state: "start", toolCallId: "tc" })).toBe(false);
  });

  it("clears timeline", () => {
    expect(clearToolTimeline()).toEqual([]);
  });

  it("inserts a tool message in place of an empty assistant placeholder", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "user", text: "现在几点了" },
      { id: 2, role: "assistant", text: "" },
    ];
    const next = upsertToolTimelineMessage(messages, { state: "start", toolCallId: "call-1", toolName: "now" }, (toolCall) => ({
      id: 3,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    }));

    expect(next.map((m) => m.role)).toEqual(["user", "tool"]);
    expect(next[1].toolCall).toMatchObject({ id: "call-1", name: "now", state: "start" });
  });

  it("keeps a thinking-only assistant message before inserting a tool message", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "assistant", text: "", thinking: "Planning the tool call." },
    ];
    const next = upsertToolTimelineMessage(messages, { state: "start", toolCallId: "call-1", toolName: "now" }, (toolCall) => ({
      id: 2,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    }));

    expect(next.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(next[0]).toMatchObject({ thinking: "Planning the tool call." });
  });

  it("updates the existing tool message by id", () => {
    const started = upsertToolTimelineMessage([], { state: "start", toolCallId: "call-1", toolName: "calc" }, (toolCall) => ({
      id: 1,
      role: "tool",
      text: "",
      toolCall,
    }));
    const ended = upsertToolTimelineMessage(started, {
      state: "end",
      toolCallId: "call-1",
      toolName: "calc",
      summary: "80,000",
    }, (toolCall) => ({ id: 2, role: "tool", text: toolCall.summary ?? "", toolCall }));

    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: 1, text: "80,000" });
    expect(ended[0].toolCall).toMatchObject({ state: "end", summary: "80,000" });
  });

  it("groups adjacent tool messages for rendering", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "user", text: "q" },
      { id: 2, role: "tool", text: "time", toolCall: { id: "call-1", name: "now", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 3, role: "tool", text: "math", toolCall: { id: "call-2", name: "calc", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 4, role: "assistant", text: "a" },
    ];

    const grouped = groupToolTimelineMessages(messages);
    expect(grouped).toHaveLength(3);
    expect(grouped[1]).toMatchObject({ kind: "tools", calls: [{ id: "call-1" }, { id: "call-2" }] });
  });

  it("ignores empty assistant placeholders between tool messages", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "tool", text: "time", toolCall: { id: "call-1", name: "now", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 2, role: "assistant", text: "" },
      { id: 3, role: "tool", text: "math", toolCall: { id: "call-2", name: "calc", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 4, role: "assistant", text: "done" },
    ];

    const grouped = groupToolTimelineMessages(messages);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ kind: "tools", calls: [{ id: "call-1" }, { id: "call-2" }] });
    expect(grouped[1]).toMatchObject({ kind: "message", message: { text: "done" } });
  });

  it("groups thinking-only assistant messages as renderable messages", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "assistant", text: "", thinking: "Reasoning notes" },
    ];

    expect(groupToolTimelineMessages(messages)).toEqual([
      { kind: "message", message: messages[0] },
    ]);
  });
});
