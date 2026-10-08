import { describe, expect, it } from "vitest";
import {
  applyToolEvent,
  clearToolTimeline,
  groupTurnTimelineMessages,
  toolCallSubject,
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

  it("shows a search query rather than its directory and tolerates unknown tool argument formats", () => {
    const call = { id: "call-1", name: "project_grep", state: "end" as const, isError: false, startedAt: 0, updatedAt: 0 };
    expect(toolCallSubject({ ...call, args: { path: "src", pattern: "Message" } })).toBe("Message");
    expect(toolCallSubject({ ...call, args: { path: "Message.tsx" } })).toBe("Message.tsx");
    expect(toolCallSubject({ ...call, args: "opaque" })).toBeUndefined();
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

    const grouped = groupTurnTimelineMessages(messages);
    expect(grouped).toHaveLength(3);
    expect(grouped[1]).toMatchObject({ kind: "process", messages: [{ toolCall: { id: "call-1" } }, { toolCall: { id: "call-2" } }] });
  });

  it("ignores empty assistant placeholders between tool messages", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "tool", text: "time", toolCall: { id: "call-1", name: "now", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 2, role: "assistant", text: "" },
      { id: 3, role: "tool", text: "math", toolCall: { id: "call-2", name: "calc", state: "end", isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 4, role: "assistant", text: "done" },
    ];

    const grouped = groupTurnTimelineMessages(messages);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ kind: "process", messages: [{ toolCall: { id: "call-1" } }, { toolCall: { id: "call-2" } }] });
    expect(grouped[1]).toMatchObject({ kind: "message", message: { text: "done" } });
  });

  it("keeps thinking-only messages in the process", () => {
    const messages: Array<ToolTimelineMessage & { id: number }> = [
      { id: 1, role: "assistant", text: "", thinking: "Reasoning notes" },
    ];

    expect(groupTurnTimelineMessages(messages)).toEqual([
      { kind: "process", key: "process-1", current: true, messages: [{ ...messages[0], contentParts: undefined, images: undefined, artifacts: undefined }] },
    ]);
  });

  it("collects interleaved progress and tools once per user turn", () => {
    const call = { id: "call-1", name: "read", state: "end" as const, isError: false, startedAt: 0, updatedAt: 0 };
    const messages = [
      { id: 1, role: "user", text: "q" },
      { id: 2, role: "assistant", text: "Checking the files", seq: 2 },
      { id: 3, role: "tool", text: "", toolCall: call },
      { id: 4, role: "assistant", text: "Found the relevant component" },
      { id: 5, role: "skill", text: "Using the design skill" },
      { id: 6, role: "tool", text: "", toolCall: { ...call, id: "call-2" } },
      { id: 7, role: "assistant", text: "The final answer" },
      { id: 8, role: "user", text: "follow-up" },
      { id: 9, role: "tool", text: "", toolCall: { ...call, id: "call-3" } },
    ];
    const grouped = groupTurnTimelineMessages(messages);
    expect(grouped.map((item) => item.kind)).toEqual(["message", "process", "message", "message", "process"]);
    expect(grouped[1]).toMatchObject({ key: "process-1", current: false, messages: messages.slice(1, 6) });
    expect(grouped[2]).toEqual({ kind: "message", message: messages[6] });
    expect(grouped[4]).toMatchObject({ key: "process-8", current: true });
    expect(messages[1]).toMatchObject({ text: "Checking the files", seq: 2 });
  });

  it("keeps errors, checkpoints, images and generated files outside the process", () => {
    const messages = [
      { id: 1, role: "assistant", text: "Generated a file", artifacts: [{}] },
      { id: 2, role: "assistant", text: "Preview", images: [{}] },
      { id: 3, role: "error", text: "Permission denied" },
      { id: 4, role: "checkpoint", text: "Summary" },
      { id: 5, role: "tool", text: "", toolCall: { id: "call-1", name: "read", state: "end" as const, isError: false, startedAt: 0, updatedAt: 0 } },
      { id: 6, role: "assistant", text: "Which approach should I use?" },
    ];
    const grouped = groupTurnTimelineMessages(messages);
    expect(grouped.filter((item) => item.kind === "message").map((item) => item.message)).toEqual([
      ...messages.slice(0, 4), messages[5],
    ]);
  });

  it("moves structured reasoning into the process without losing answer parts or duplicating message anchors", () => {
    const messages = [{
      id: 1, role: "assistant", text: "Answer", seq: 12,
      contentParts: [
        { partId: "p1", kind: "thinking" as const, text: "Reasoning", sequence: 1 },
        { partId: "p2", kind: "text" as const, text: "Answer", sequence: 2 },
      ],
    }];
    const grouped = groupTurnTimelineMessages(messages);
    expect(grouped[0]).toMatchObject({ kind: "process", messages: [{ text: "", thinking: "Reasoning", seq: undefined, contentParts: [messages[0].contentParts[0]] }] });
    expect(grouped[1]).toMatchObject({ kind: "message", message: { text: "Answer", thinking: undefined, seq: 12, contentParts: [messages[0].contentParts[1]] } });
    expect(messages[0].contentParts).toHaveLength(2);
  });

  it("keeps a stable process key as tools and progress arrive", () => {
    const messages = [
      { id: 1, role: "user", text: "q" },
      { id: 2, role: "assistant", text: "", thinking: "Planning" },
    ];
    const before = groupTurnTimelineMessages(messages)[1];
    const after = groupTurnTimelineMessages(upsertToolTimelineMessage(messages, { state: "start", toolCallId: "call-1", toolName: "read" }, (toolCall) => ({ id: 3, role: "tool", text: "", toolCall })))[1];
    expect(before).toMatchObject({ kind: "process", key: "process-1" });
    expect(after).toMatchObject({ kind: "process", key: "process-1" });
  });
});
