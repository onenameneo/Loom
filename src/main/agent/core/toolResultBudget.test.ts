import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  applyToolResultBudget,
  createToolResultBudgetState,
  DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS,
  persistToolResultSidecars,
  toolResultSidecarDir,
  toolResultSidecarPath,
  toolResultSidecarPathForMessage,
} from "./toolResultBudget";

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });
const toolResult = (id: string, toolName: string, text: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName,
  content: [{ type: "text", text }],
  isError: false,
  timestamp: 0,
});

describe("applyToolResultBudget", () => {
  it("returns the same messages when there are no tool results", () => {
    const messages = [user("hello")];
    const state = createToolResultBudgetState();

    const result = applyToolResultBudget(messages, state);

    expect(result.messages).toEqual(messages);
    expect(result.persistedResults).toEqual([]);
    expect(state.seenIds.size).toBe(0);
  });

  it("replaces one large tool result when the default group threshold is exceeded", () => {
    const state = createToolResultBudgetState();
    const big = toolResult("tc-big", "big_tool", "x".repeat(DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS + 1));

    const result = applyToolResultBudget([big], state, { referenceFor: () => "/tmp/tc-big.txt" });
    const projected = result.messages[0] as ToolResultMessage;

    expect(projected.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("tool_result_group_budget_exceeded") });
    expect(projected.content[0]).toMatchObject({ text: expect.stringContaining("toolCallId: tc-big") });
    expect(result.persistedResults).toEqual([{ toolCallId: "tc-big", toolName: "big_tool", path: "/tmp/tc-big.txt", content: "x".repeat(DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS + 1) }]);
    expect(big.content[0]).toMatchObject({ text: "x".repeat(DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS + 1) });
  });

  it("uses consecutive tool result groups for aggregate size accounting", () => {
    const state = createToolResultBudgetState();
    const first = toolResult("tc-1", "search", "a".repeat(1_000));
    const second = toolResult("tc-2", "search", "b".repeat(70));

    const result = applyToolResultBudget([first, second], state, {
      maxToolResultGroupChars: 500,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({ text: expect.stringContaining("toolCallId: tc-1") });
    expect((result.messages[1] as ToolResultMessage).content[0]).toMatchObject({ text: "b".repeat(70) });
  });

  it("keeps non-consecutive groups independent", () => {
    const state = createToolResultBudgetState();
    const first = toolResult("tc-1", "search", "a".repeat(70));
    const second = toolResult("tc-2", "search", "b".repeat(70));

    const result = applyToolResultBudget([first, user("separator"), second], state, {
      maxToolResultGroupChars: 100,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({ text: "a".repeat(70) });
    expect((result.messages[2] as ToolResultMessage).content[0]).toMatchObject({ text: "b".repeat(70) });
  });

  it("replaces tool results at their original message positions", () => {
    const state = createToolResultBudgetState();
    const first = toolResult("tc-1", "search", "a".repeat(120));

    const result = applyToolResultBudget([user("prefix"), first], state, {
      maxToolResultGroupChars: 50,
      referenceFor: (message) => `/tmp/${message.toolCallId}.txt`,
    });

    expect(result.messages[0]).toEqual(user("prefix"));
    expect((result.messages[1] as ToolResultMessage).content[0]).toMatchObject({ text: expect.stringContaining("toolCallId: tc-1") });
  });

  it("reapplies stable replacement text for an already replaced tool result", () => {
    const state = createToolResultBudgetState();
    const big = toolResult("tc-big", "big_tool", "x".repeat(120));
    const first = applyToolResultBudget([big], state, {
      maxToolResultGroupChars: 50,
      referenceFor: () => "/tmp/original.txt",
    });
    const replacement = ((first.messages[0] as ToolResultMessage).content[0] as any).text;

    const second = applyToolResultBudget([toolResult("tc-big", "big_tool", "changed")], state, {
      maxToolResultGroupChars: 1_000_000,
      referenceFor: () => "/tmp/changed.txt",
    });

    expect(((second.messages[0] as ToolResultMessage).content[0] as any).text).toBe(replacement);
    expect(second.persistedResults).toEqual([]);
  });

  it("does not replace previously seen pass-through results later", () => {
    const state = createToolResultBudgetState();
    const first = toolResult("tc-small", "search", "small");

    applyToolResultBudget([first], state, { maxToolResultGroupChars: 100 });
    const second = applyToolResultBudget([toolResult("tc-small", "search", "x".repeat(120))], state, { maxToolResultGroupChars: 50 });

    expect((second.messages[0] as ToolResultMessage).content[0]).toMatchObject({ text: "x".repeat(120) });
    expect(second.persistedResults).toEqual([]);
  });

  it("skips opt-out tools and marks them seen", () => {
    const state = createToolResultBudgetState();
    const skipped = toolResult("tc-skip", "project_read_file", "x".repeat(120));

    const result = applyToolResultBudget([skipped], state, {
      maxToolResultGroupChars: 50,
      skipToolNames: ["project_read_file"],
    });

    expect((result.messages[0] as ToolResultMessage).content[0]).toMatchObject({ text: "x".repeat(120) });
    expect(state.seenIds.has("tc-skip")).toBe(true);
  });
});

describe("tool result sidecar paths", () => {
  it("derives sidecar directories from userData and session id", () => {
    expect(toolResultSidecarDir("/Users/neo/Library/Application Support/Loom", "abc")).toBe(
      "/Users/neo/Library/Application Support/Loom/sessions/abc/tool-results",
    );
    expect(toolResultSidecarPath("/Users/neo/Library/Application Support/Loom", "abc", "tc-1")).toBe(
      "/Users/neo/Library/Application Support/Loom/sessions/abc/tool-results/tc-1.txt",
    );
  });

  it("uses json for structured text block results", () => {
    const message: ToolResultMessage = {
      ...toolResult("tc-json", "multi", "first"),
      content: [{ type: "text", text: "first" }, { type: "text", text: "second" }],
    };

    expect(toolResultSidecarPathForMessage("/tmp/Loom", "sess", message)).toBe("/tmp/Loom/sessions/sess/tool-results/tc-json.json");
  });

  it("persists sidecar files with create-only semantics", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-tool-results-"));
    try {
      const path = join(dir, "sessions", "sess", "tool-results", "tc.txt");
      persistToolResultSidecars([{ toolCallId: "tc", toolName: "search", path, content: "first" }]);
      writeFileSync(path, "existing", "utf-8");
      persistToolResultSidecars([{ toolCallId: "tc", toolName: "search", path, content: "second" }]);

      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("existing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
