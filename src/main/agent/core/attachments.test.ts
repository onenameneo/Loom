import { describe, expect, it } from "vitest";
import {
  attachmentMessages,
  collectProjectFileAttachmentCandidates,
  collectSkillAttachmentCandidates,
  collectToolResultReferenceCandidates,
  planContextAttachments,
  type LoomContextAttachmentCandidate,
} from "./attachments";

function candidate(input: Partial<LoomContextAttachmentCandidate> & Pick<LoomContextAttachmentCandidate, "id" | "kind" | "text">): LoomContextAttachmentCandidate {
  return {
    version: 1,
    id: input.id,
    kind: input.kind,
    text: input.text,
    source: input.source ?? { identity: input.id },
    tokens: input.tokens ?? { tokens: Math.max(1, Math.ceil(input.text.length / 2)), exact: false },
    priority: input.priority ?? 0,
  };
}

describe("context attachments", () => {
  it("plans deterministic, deduplicated attachments within item and aggregate budgets", () => {
    const result = planContextAttachments([
      candidate({ id: "old", kind: "file-context", text: "123456", priority: 20, tokens: { tokens: 3, exact: false } }),
      candidate({ id: "new", kind: "file-context", text: "1234567890", priority: 1, tokens: { tokens: 5, exact: true } }),
      candidate({ id: "new", kind: "file-context", text: "duplicate", priority: 2, tokens: { tokens: 1, exact: true } }),
      candidate({ id: "skill", kind: "skill-context", text: "skill", priority: 3, tokens: { tokens: 2, exact: false } }),
      candidate({ id: "oversized", kind: "tool-result-reference", text: "oversized", priority: 4, tokens: { tokens: 6, exact: false } }),
    ], { maxTokens: 7, maxItemTokens: 5 });

    expect(result.attachments.map((item) => item.id)).toEqual(["new", "skill"]);
    expect(result.diagnostics).toMatchObject({ selectedCount: 2, omittedCount: 3, tokens: 7, source: "mixed" });
    expect(result.diagnostics.omissions).toEqual([
      { id: "old", reason: "aggregate-budget" },
      { id: "oversized", reason: "item-budget" },
      { id: "new", reason: "duplicate" },
    ]);
  });

  it("converts only supported persisted kinds into synthetic user messages", () => {
    const messages = attachmentMessages([
      candidate({ id: "file", kind: "file-context", text: "file body", priority: 1 }),
      candidate({ id: "unknown", kind: "future-kind" as never, text: "ignore", priority: 2 }),
    ], 42);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", timestamp: 42 });
    expect((messages[0] as any).content).toContain("file-context");
    expect((messages[0] as any).content).toContain("file body");
  });

  it("uses final synthetic message accounting when planning attachments", () => {
    const result = planContextAttachments([
      candidate({ id: "wrapped", kind: "file-context", text: "body", tokens: { tokens: 1, exact: true }, priority: 1 }),
    ], {
      maxTokens: 8,
      maxItemTokens: 8,
      tokenCounter: () => ({ tokens: 8, exact: false }),
    });

    expect(result.attachments[0]?.tokens).toEqual({ tokens: 8, exact: false });
    expect(result.diagnostics).toMatchObject({ selectedCount: 1, tokens: 8, source: "mixed" });
  });

  it("collects bounded project file context only from paired tool calls/results", () => {
    const messages: any[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "project_read_file", args: { path: "src/app.ts" } }], timestamp: 0 },
      { role: "toolResult", toolCallId: "call-other", toolName: "project_read_file", content: "wrong", details: { path: "../secret" }, timestamp: 0 },
      { role: "toolResult", toolCallId: "call-1", toolName: "project_read_file", content: "valid file\n" + "x".repeat(100), details: { path: "./src/app.ts", version: "v1" }, timestamp: 0 },
    ];
    const candidates = collectProjectFileAttachmentCandidates(messages, { maxChars: 20 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "file-context", source: { path: "src/app.ts", version: "v1", toolCallId: "call-1" } });
    expect(candidates[0]!.text.length).toBe(20);
  });

  it("creates skill references from effective replay state and sidecar references only via validation", () => {
    const skills = collectSkillAttachmentCandidates([{
      id: "research", name: "Research", description: "desc", sourceScope: "project", sourceId: "p", sourcePath: "/skills/research/SKILL.md", hash: "abc",
      enabledEventId: "event-1", diagnostics: [
        { level: "warn", code: "source-missing", message: "Enabled skill source is no longer discovered." },
        { level: "warn", code: "hash-drift", message: "Skill hash changed." },
      ], current: undefined,
    }]);
    expect(skills[0]).toMatchObject({ kind: "skill-context", source: { skillId: "research", hash: "abc" } });
    expect(skills[0]!.text).toContain("source-missing");
    expect(skills[0]!.text).toContain("hash-drift");

    const refs = collectToolResultReferenceCandidates([
      { role: "toolResult", toolCallId: "call-1", toolName: "search", content: "x", timestamp: 0 },
      { role: "toolResult", toolCallId: "call-2", toolName: "search", content: "x", timestamp: 0 },
    ] as any, (message) => message.toolCallId === "call-1" ? "/validated/call-1.txt" : undefined);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "tool-result-reference", source: { toolCallId: "call-1", path: "/validated/call-1.txt" } });
  });
});
