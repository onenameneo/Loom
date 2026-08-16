import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createLoomContextCheckpoint,
  createLoomFrozenBranchSummary,
  createLoomSplitTurnContext,
  isLoomContextCheckpoint,
  isLoomFrozenBranchSummary,
  isLoomSplitTurnContext,
  serializeLoomDerivedMessage,
} from "./messages";
import type { LoomContextAttachment } from "./attachments";

describe("Loom derived context messages", () => {
  it("round-trips versioned context checkpoints through serialization", () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: "n1",
      createdAt: 100,
      reason: "threshold",
      summary: "Goal\n- keep going",
      coverage: { fromSeq: 0, toSeq: 8 },
      retainedTail: { fromSeq: 9, toSeq: 12 },
      diagnostics: {
        before: { tokens: 32000, exact: true },
        after: { tokens: 9000, exact: false },
      },
      summaryUsage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, exact: true },
    });

    const serialized = serializeLoomDerivedMessage(checkpoint as AgentMessage);

    expect(isLoomContextCheckpoint(serialized)).toBe(true);
    expect(serialized).toMatchObject({ role: "loomContextCheckpoint", version: 1, nodeId: "n1" });
  });

  it("accepts optional attachments and remains compatible with unknown future kinds", () => {
    const attachment: LoomContextAttachment = {
      version: 1,
      kind: "file-context",
      id: "file:src/app.ts:2",
      source: { identity: "file:src/app.ts:2", path: "src/app.ts", version: "v2" },
      text: "const answer = 42;",
      tokens: { tokens: 5, exact: false },
    };
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-attachments",
      nodeId: "n1",
      createdAt: 100,
      reason: "manual",
      summary: "summary",
      coverage: { fromSeq: 0, toSeq: 2 },
      retainedTail: { fromSeq: 3, toSeq: 3 },
      diagnostics: {
        before: { tokens: 10, exact: false },
        after: { tokens: 8, exact: false },
        attachments: { selectedCount: 1, omittedCount: 0, tokens: 5, source: "estimated" },
      },
      attachments: [attachment, { ...attachment, id: "future", kind: "future-kind" as never }],
    });

    expect(isLoomContextCheckpoint(serializeLoomDerivedMessage(checkpoint as AgentMessage))).toBe(true);
  });

  it("accepts split-turn context and immutable frozen branch summaries", () => {
    const split = createLoomSplitTurnContext({
      id: "split-1",
      nodeId: "n1",
      createdAt: 101,
      sourceTurn: { fromSeq: 4, toSeq: 6 },
      retainedSuffix: { fromSeq: 6, toSeq: 6 },
      summary: "Earlier part of an oversized turn.",
      truncated: true,
    });
    const frozen = createLoomFrozenBranchSummary({
      id: "fb-1",
      childNodeId: "n2",
      createdAt: 102,
      source: { parentNodeId: "n1", fingerprint: "abc123", fromSeq: 0, toSeq: 20 },
      summary: "Frozen ancestor summary.",
      retainedContext: [{ role: "user", content: "tail", timestamp: 0 } as any],
      diagnostics: { before: { tokens: 64000, exact: false }, after: { tokens: 6000, exact: false } },
    });

    expect(isLoomSplitTurnContext(split as AgentMessage)).toBe(true);
    expect(isLoomFrozenBranchSummary(frozen as AgentMessage)).toBe(true);
  });

  it("rejects malformed legacy/custom payloads without throwing", () => {
    expect(isLoomContextCheckpoint({ role: "loomContextCheckpoint", version: 99 } as unknown as AgentMessage)).toBe(false);
    expect(isLoomSplitTurnContext({ role: "loomSplitTurnContext", version: 1, summary: "" } as AgentMessage)).toBe(false);
    expect(isLoomFrozenBranchSummary({ role: "loomFrozenBranchSummary", version: 1, retainedContext: "bad" } as unknown as AgentMessage)).toBe(false);
  });
});
