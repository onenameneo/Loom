import { describe, expect, it } from "vitest";
import type { LiveTurnContentPart, LiveTurnSnapshot } from "../env";
import { appendLiveTurnMessage } from "./liveTurnMessages";

type TestMessage = { role: string; text: string; thinking?: string; id: number };

const snapshot = (assistantText: string, assistantThinking?: string): LiveTurnSnapshot => ({
  nodeId: "node-1",
  sessionId: "session-1",
  turnId: "turn-1",
  operation: "send",
  state: "running",
  revision: 1,
  assistantText,
  assistantThinking,
});

const orderedSnapshot = (parts: LiveTurnContentPart[]): LiveTurnSnapshot => ({
  ...snapshot(
    parts.filter((part) => part.kind === "text").map((part) => part.text).join(""),
    parts.filter((part) => part.kind === "thinking").map((part) => part.text).join(""),
  ),
  contentParts: parts,
  contentSequence: parts.length,
});

describe("appendLiveTurnMessage", () => {
  it("appends only the new cumulative assistant suffix after a tool message", () => {
    let messages: TestMessage[] = [{ id: 1, role: "user", text: "Investigate" }];
    messages = appendLiveTurnMessage(messages, snapshot("I'll investigate"), (text, thinking) => ({ id: 2, role: "assistant", text, thinking }));
    messages.push({ id: 3, role: "tool", text: "project_list_files" });
    messages = appendLiveTurnMessage(messages, snapshot("I'll investigate the OpenSpec changes"), (text, thinking) => ({ id: 4, role: "assistant", text, thinking }));

    expect(messages.filter((message) => message.role === "assistant").map((message) => message.text)).toEqual([
      "I'll investigate",
      " the OpenSpec changes",
    ]);
  });

  it("does not create an empty assistant message for a live snapshot with no text", () => {
    const messages: TestMessage[] = [{ id: 1, role: "user", text: "Investigate" }];

    expect(appendLiveTurnMessage(messages, snapshot(""), (text, thinking) => ({ id: 2, role: "assistant", text, thinking }))).toBe(messages);
  });

  it("ignores a snapshot that is not a cumulative continuation", () => {
    const messages: TestMessage[] = [
      { id: 1, role: "user", text: "Investigate" },
      { id: 2, role: "assistant", text: "I'll investigate" },
    ];

    expect(appendLiveTurnMessage(messages, snapshot("reset"), (text, thinking) => ({ id: 3, role: "assistant", text, thinking }))).toBe(messages);
  });

  it("replaces the active structured assistant message after an authoritative reset", () => {
    const messages: Array<TestMessage & { contentParts?: LiveTurnContentPart[] }> = [
      { id: 1, role: "user", text: "Investigate" },
      { id: 2, role: "assistant", text: "old answer", contentParts: [{ partId: "old", kind: "text", text: "old answer", sequence: 1 }] },
    ];
    const reset = orderedSnapshot([{ partId: "new", kind: "text", text: "rewritten answer", sequence: 1 }]);
    const next = appendLiveTurnMessage(messages, reset, (text, thinking, contentParts) => ({ id: 3, role: "assistant", text, thinking, contentParts }));

    expect(next.map((message) => message.text)).toEqual(["Investigate", "rewritten answer"]);
    expect(next[1]?.contentParts?.[0]?.partId).toBe("new");
  });

  it("preserves the ordered thinking/text parts across a tool boundary", () => {
    let messages: Array<TestMessage & { contentParts?: LiveTurnContentPart[] }> = [{ id: 1, role: "user", text: "Investigate" }];
    const firstParts = [
      { partId: "part-thinking", kind: "thinking" as const, text: "plan", sequence: 1 },
      { partId: "part-text", kind: "text" as const, text: "answer", sequence: 2 },
    ];
    messages = appendLiveTurnMessage(messages, orderedSnapshot(firstParts), (text, thinking, contentParts) => ({ id: 2, role: "assistant", text, thinking, contentParts }));
    messages.push({ id: 3, role: "tool", text: "tool" });
    const nextParts = [...firstParts, { partId: "part-text-2", kind: "text" as const, text: "after tool", sequence: 3 }];
    messages = appendLiveTurnMessage(messages, orderedSnapshot(nextParts), (text, thinking, contentParts) => ({ id: 4, role: "assistant", text, thinking, contentParts }));

    expect(messages.filter((message) => message.role === "assistant").map((message) => message.contentParts?.map((part) => [part.kind, part.text]))).toEqual([
      [["thinking", "plan"], ["text", "answer"]],
      [["text", "after tool"]],
    ]);
  });
});
