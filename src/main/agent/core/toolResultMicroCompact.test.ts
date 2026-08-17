import { describe, expect, it } from "vitest";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  applyToolResultMicroCompact,
  createToolResultMicroCompactState,
  DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES,
} from "./toolResultMicroCompact";

const minute = 60_000;
const now = 100 * minute;
const assistant = (timestamp: number | string | undefined): Message =>
  ({ role: "assistant", content: "done", timestamp } as unknown as Message);
const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });
const toolResult = (id: string, toolName: string, text: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName,
  content: [{ type: "text", text }],
  isError: false,
  timestamp: 0,
});

describe("applyToolResultMicroCompact", () => {
  it("returns the same messages when the idle gap is below the configured threshold", () => {
    const state = createToolResultMicroCompactState();
    const old = toolResult("tc-old", "search", "old output");

    const result = applyToolResultMicroCompact([old], state, {
      now,
      sourceMessages: [assistant(now - 10 * minute)],
      idleGapMinutes: 60,
      keepRecentToolResults: 1,
    });

    expect(result.messages).toEqual([old]);
    expect(result.persistedResults).toEqual([]);
    expect(result.diagnostics).toBeUndefined();
    expect(state.replacements.size).toBe(0);
  });

  it("uses a named 60 minute default threshold and allows overriding it", () => {
    expect(DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES).toBe(60);
    const state = createToolResultMicroCompactState();
    const old = toolResult("tc-old", "search", "old output");
    const recent = toolResult("tc-recent", "search", "recent output");

    const defaultResult = applyToolResultMicroCompact([old, recent], state, {
      now,
      sourceMessages: [assistant(now - 30 * minute)],
      keepRecentToolResults: 1,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });
    expect(defaultResult.messages).toEqual([old, recent]);

    const overridden = applyToolResultMicroCompact([old, recent], createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant(now - 30 * minute)],
      idleGapMinutes: 20,
      keepRecentToolResults: 1,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });
    expect((overridden.messages[0] as ToolResultMessage).content[0]).toMatchObject({
      text: expect.stringContaining("stale_tool_result_microcompact"),
    });
    expect((overridden.messages[1] as ToolResultMessage).content[0]).toMatchObject({ text: "recent output" });
  });

  it("returns unchanged messages when the newest assistant timestamp is missing or unparseable", () => {
    const messages = [toolResult("tc-1", "search", "old"), toolResult("tc-2", "search", "recent")];

    expect(applyToolResultMicroCompact(messages, createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant(undefined)],
      keepRecentToolResults: 1,
    }).messages).toEqual(messages);

    expect(applyToolResultMicroCompact(messages, createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant("not-a-date")],
      keepRecentToolResults: 1,
    }).messages).toEqual(messages);
  });

  it("replaces older eligible results while retaining the newest configured count", () => {
    const state = createToolResultMicroCompactState();
    const first = toolResult("tc-1", "search", "first output");
    const second = toolResult("tc-2", "search", "second output");
    const third = toolResult("tc-3", "search", "third output");

    const result = applyToolResultMicroCompact([first, second, third], state, {
      now,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 2,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({
      text: expect.stringContaining("toolCallId: tc-1"),
    });
    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({
      text: expect.stringContaining("fullResult: /tmp/tc-1.txt"),
    });
    expect((result.messages[0] as ToolResultMessage).content[0]).not.toMatchObject({ text: expect.stringContaining("first output") });
    expect((result.messages[1] as ToolResultMessage).content[0]).toMatchObject({ text: "second output" });
    expect((result.messages[2] as ToolResultMessage).content[0]).toMatchObject({ text: "third output" });
    expect(result.persistedResults).toEqual([{ toolCallId: "tc-1", toolName: "search", path: "/tmp/tc-1.txt", content: "first output" }]);
    expect(result.diagnostics).toMatchObject({
      trigger: "time_idle",
      idleGapMinutes: 90,
      retainedCount: 2,
      replacedCount: 1,
      estimatedCharsSaved: expect.any(Number),
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain("first output");
  });

  it("floors the retain count at one", () => {
    const result = applyToolResultMicroCompact([
      toolResult("tc-1", "search", "first"),
      toolResult("tc-2", "search", "second"),
    ], createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 0,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({ text: expect.stringContaining("toolCallId: tc-1") });
    expect((result.messages[1] as ToolResultMessage).content[0]).toMatchObject({ text: "second" });
  });

  it("reuses stable replacement text for an already microCompacted tool result", () => {
    const state = createToolResultMicroCompactState();
    const first = applyToolResultMicroCompact([
      toolResult("tc-1", "search", "first"),
      toolResult("tc-2", "search", "second"),
    ], state, {
      now,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 1,
      referenceFor: () => "/tmp/original.txt",
    });
    const replacement = ((first.messages[0] as ToolResultMessage).content[0] as any).text;

    const second = applyToolResultMicroCompact([
      toolResult("tc-1", "search", "changed content"),
      toolResult("tc-2", "search", "second"),
    ], state, {
      now: now + minute,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 1,
      referenceFor: () => "/tmp/changed.txt",
    });

    expect(((second.messages[0] as ToolResultMessage).content[0] as any).text).toBe(replacement);
    expect(second.persistedResults).toEqual([]);
  });

  it("leaves opt-out tools and non-text payloads unchanged", () => {
    const skipped = toolResult("tc-skip", "read", "full file");
    const image = {
      ...toolResult("tc-image", "search", "image"),
      content: [{ type: "image", mimeType: "image/png", data: "abc" }],
    } as unknown as ToolResultMessage;
    const kept = toolResult("tc-kept", "search", "recent");

    const result = applyToolResultMicroCompact([skipped, image, kept], createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 1,
      skipToolNames: ["read"],
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect(result.messages[0]).toEqual(skipped);
    expect(result.messages[1]).toEqual(image);
    expect(result.messages[2]).toEqual(kept);
    expect(result.persistedResults).toEqual([]);
    expect(result.diagnostics).toBeUndefined();
  });

  it("preserves tool result metadata when projecting replacement content", () => {
    const original = {
      ...toolResult("tc-1", "search", "old"),
      isError: true,
      timestamp: 123,
    };
    const recent = toolResult("tc-2", "search", "recent");

    const result = applyToolResultMicroCompact([user("prefix"), original, recent], createToolResultMicroCompactState(), {
      now,
      sourceMessages: [assistant(now - 90 * minute)],
      keepRecentToolResults: 1,
      referenceFor: () => "/tmp/tc-1.txt",
    });

    expect(result.messages[0]).toEqual(user("prefix"));
    expect(result.messages[1]).toMatchObject({
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "search",
      isError: true,
      timestamp: 123,
    });
  });
});
