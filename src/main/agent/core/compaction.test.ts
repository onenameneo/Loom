import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  CHECKPOINT_SUMMARY_SECTIONS,
  buildCheckpointSummaryInput,
  checkpointSummarySystemPrompt,
  planFrozenBranchContext,
  planTurnSafeCut,
  serializeTranscriptForCheckpoint,
} from "./compaction";
import { createLoomContextCheckpoint } from "./messages";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const assistant = (text: string): AgentMessage => ({ role: "assistant", content: text, timestamp: 0 }) as unknown as AgentMessage;
const assistantToolCall = (id: string): AgentMessage =>
  ({ role: "assistant", content: "", toolCalls: [{ id, name: "read", args: {} }], timestamp: 0 }) as unknown as AgentMessage;
const toolResult = (id: string, text = "result"): AgentMessage =>
  ({ role: "toolResult", toolCallId: id, toolName: "read", content: text, timestamp: 0 }) as unknown as AgentMessage;

const countByIndex = (tokens: number[]) => (_msg: AgentMessage, index: number) => tokens[index] ?? 1;

describe("planTurnSafeCut", () => {
  it("prefers retaining complete newest user turns", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), assistant("a2"), user("u3"), assistant("a3")];

    const plan = planTurnSafeCut(messages, { tailBudgetTokens: 5, tokenCounter: countByIndex([2, 2, 2, 2, 2, 2]) });

    expect(plan).toMatchObject({
      kind: "retain-tail",
      compactThroughSeq: 3,
      retainedFromSeq: 4,
      retainedTokenCount: 4,
    });
  });

  it("does not separate an assistant tool call from its tool result", () => {
    const messages = [user("u1"), assistantToolCall("tc1"), toolResult("tc1"), user("u2"), assistant("a2")];

    const plan = planTurnSafeCut(messages, { tailBudgetTokens: 4, tokenCounter: countByIndex([1, 1, 1, 2, 2]) });

    expect(plan).toMatchObject({
      kind: "retain-tail",
      compactThroughSeq: 2,
      retainedFromSeq: 3,
    });
  });

  it("splits an oversized newest turn explicitly", () => {
    const messages = [user("u1"), assistant("a1"), user("large"), assistant("suffix")];

    const plan = planTurnSafeCut(messages, { tailBudgetTokens: 4, tokenCounter: countByIndex([1, 1, 5, 2]) });

    expect(plan).toMatchObject({
      kind: "split-turn",
      compactThroughSeq: 2,
      retainedFromSeq: 3,
      splitTurn: {
        sourceTurn: { fromSeq: 2, toSeq: 3 },
        retainedSuffix: { fromSeq: 3, toSeq: 3 },
      },
    });
  });

  it("returns no-op for empty and already-fitting histories", () => {
    expect(planTurnSafeCut([], { tailBudgetTokens: 4 })).toMatchObject({ kind: "none" });
    expect(planTurnSafeCut([user("u"), assistant("a")], { tailBudgetTokens: 10, tokenCounter: countByIndex([2, 2]) })).toMatchObject({
      kind: "none",
      retainedFromSeq: 0,
      compactThroughSeq: -1,
    });
  });

  it("uses unbounded token estimates so oversized single messages can be compacted", () => {
    const plan = planTurnSafeCut([user("x".repeat(40_000))], { tailBudgetTokens: 12_000 });

    expect(plan).toMatchObject({
      kind: "retain-tail",
      compactThroughSeq: 0,
      retainedFromSeq: 1,
      retainedTokenCount: 0,
    });
  });
});

describe("checkpoint summary serialization", () => {
  it("serializes transcript and tool activity with bounded payloads", () => {
    const messages = [
      user("read the file"),
      assistantToolCall("tc-read"),
      toolResult("tc-read", "src/main/agent/core/context.ts\n" + "x".repeat(100)),
    ];

    const serialized = serializeTranscriptForCheckpoint(messages, {
      fromSeq: 0,
      toSeq: 2,
      maxMessageChars: 24,
      maxToolActivityChars: 32,
    });

    expect(serialized.truncated).toBe(true);
    expect(serialized.items[2]).toMatchObject({ seq: 2, role: "toolResult", truncated: true });
    expect(serialized.items[2]?.text.length).toBeLessThanOrEqual(24);
    expect(serialized.toolActivity[0]).toMatchObject({ toolCallId: "tc-read", toolName: "read", truncated: true });
    expect(serialized.toolActivity[0]?.text.length).toBeLessThanOrEqual(32);
  });

  it("builds a structured iterative checkpoint input with previous summary", () => {
    const previous = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: "n1",
      createdAt: 1,
      reason: "threshold",
      summary: "Previous decisions.",
      coverage: { fromSeq: 0, toSeq: 3 },
      retainedTail: { fromSeq: 4, toSeq: 5 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 50, exact: true } },
    });

    const input = buildCheckpointSummaryInput({
      previousCheckpoint: previous,
      messages: [user("new work")],
      range: { fromSeq: 4, toSeq: 4 },
    });

    expect(input.previousCheckpointSummary).toBe("Previous decisions.");
    expect(input.systemPrompt).toContain("Goal");
    expect(input.systemPrompt).toContain("Critical Context");
    expect(CHECKPOINT_SUMMARY_SECTIONS).toEqual([
      "Goal",
      "Constraints & Preferences",
      "Progress",
      "Key Decisions",
      "Next Steps",
      "Critical Context",
    ]);
    expect(checkpointSummarySystemPrompt()).toBe(input.systemPrompt);
  });
});

describe("planFrozenBranchContext", () => {
  it("keeps a raw immutable ancestor snapshot when it fits the child budget", () => {
    const plan = planFrozenBranchContext({
      ancestorMessages: [user("u1"), assistant("a1")],
      maxRawSnapshotTokens: 10,
      tokenCounter: countByIndex([2, 2]),
      childNodeId: "child",
      parentNodeId: "parent",
      now: 1,
    });

    expect(plan).toMatchObject({ kind: "raw-snapshot" });
    expect(plan.rawSnapshot?.map((message) => (message as any).content)).toEqual(["u1", "a1"]);
  });

  it("creates a child-owned frozen branch summary with bounded retained context when raw ancestors exceed budget", () => {
    const plan = planFrozenBranchContext({
      ancestorMessages: [user("u1"), assistant("a1"), user("u2"), assistant("a2")],
      maxRawSnapshotTokens: 5,
      tokenCounter: countByIndex([3, 3, 2, 2]),
      childNodeId: "child",
      parentNodeId: "parent",
      now: 2,
    });

    expect(plan.kind).toBe("frozen-summary");
    expect(plan.frozenSummary).toMatchObject({
      role: "loomFrozenBranchSummary",
      childNodeId: "child",
      source: { parentNodeId: "parent", fromSeq: 0, toSeq: 3 },
      retainedContext: [{ role: "user", content: "u2" }, { role: "assistant", content: "a2" }],
    });
    expect(plan.rawSnapshot).toBeUndefined();
  });
});
