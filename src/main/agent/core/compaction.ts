import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { estimateMessageTokensUnbounded } from "./budget";
import { isLlmMessage, roleOf, textOf } from "./context";
import {
  createLoomFrozenBranchSummary,
  type LoomContextCheckpointMessage,
  type LoomFrozenBranchSummaryMessage,
  type LoomSourceRange,
} from "./messages";

export interface TurnSafeCutOptions {
  tailBudgetTokens: number;
  tokenCounter?: (msg: AgentMessage, index: number) => number;
}

export type TurnSafeCutPlan =
  | {
      kind: "none";
      compactThroughSeq: -1;
      retainedFromSeq: 0;
      retainedTokenCount: number;
    }
  | {
      kind: "retain-tail";
      compactThroughSeq: number;
      retainedFromSeq: number;
      retainedTokenCount: number;
    }
  | {
      kind: "split-turn";
      compactThroughSeq: number;
      retainedFromSeq: number;
      retainedTokenCount: number;
      splitTurn: {
        sourceTurn: LoomSourceRange;
        retainedSuffix: LoomSourceRange;
      };
    };

interface TurnRange extends LoomSourceRange {
  tokens: number;
}

export const CHECKPOINT_SUMMARY_SECTIONS = [
  "Goal",
  "Constraints & Preferences",
  "Progress",
  "Key Decisions",
  "Next Steps",
  "Critical Context",
] as const;

export interface SerializedCheckpointMessage {
  seq: number;
  role: string;
  text: string;
  truncated: boolean;
  toolCallId?: string;
  toolName?: string;
}

export interface SerializedToolActivity {
  seq: number;
  toolCallId: string;
  toolName: string;
  text: string;
  truncated: boolean;
  paths: string[];
}

export interface SerializedCheckpointTranscript {
  range: LoomSourceRange;
  items: SerializedCheckpointMessage[];
  toolActivity: SerializedToolActivity[];
  truncated: boolean;
}

export interface TranscriptSerializationOptions extends LoomSourceRange {
  maxMessageChars?: number;
  maxToolActivityChars?: number;
}

export interface CheckpointSummaryInput {
  systemPrompt: string;
  previousCheckpointSummary?: string;
  transcript: SerializedCheckpointTranscript;
}

export interface FrozenBranchPlanInput {
  ancestorMessages: AgentMessage[];
  maxRawSnapshotTokens: number;
  childNodeId: string;
  parentNodeId: string;
  now: number;
  tokenCounter?: (msg: AgentMessage, index: number) => number;
}

export type FrozenBranchPlan =
  | {
      kind: "raw-snapshot";
      rawSnapshot: AgentMessage[];
      frozenSummary?: undefined;
      diagnostics: { before: { tokens: number; exact: boolean }; after: { tokens: number; exact: boolean } };
    }
  | {
      kind: "frozen-summary";
      rawSnapshot?: undefined;
      frozenSummary: LoomFrozenBranchSummaryMessage;
      diagnostics: { before: { tokens: number; exact: boolean }; after: { tokens: number; exact: boolean } };
    };

export function planTurnSafeCut(messages: AgentMessage[], options: TurnSafeCutOptions): TurnSafeCutPlan {
  const tokenCounter = options.tokenCounter ?? ((msg: AgentMessage) => estimateMessageTokensUnbounded(msg));
  const tokens = messages.map((msg, index) => Math.max(0, Math.round(tokenCounter(msg, index))));
  const total = tokens.reduce((sum, value) => sum + value, 0);
  const budget = Math.max(0, Math.round(options.tailBudgetTokens));
  if (messages.length === 0 || total <= budget) {
    return { kind: "none", compactThroughSeq: -1, retainedFromSeq: 0, retainedTokenCount: total };
  }

  const turns = userTurns(messages, tokens);
  if (turns.length === 0) {
    return { kind: "none", compactThroughSeq: -1, retainedFromSeq: 0, retainedTokenCount: total };
  }

  let retainedTokenCount = 0;
  let retainedFromSeq = messages.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (retainedTokenCount + turn.tokens > budget) break;
    retainedTokenCount += turn.tokens;
    retainedFromSeq = turn.fromSeq;
  }

  if (retainedFromSeq < messages.length) {
    return {
      kind: "retain-tail",
      compactThroughSeq: retainedFromSeq - 1,
      retainedFromSeq,
      retainedTokenCount,
    };
  }

  const newest = turns[turns.length - 1]!;
  const suffix = suffixWithinBudget(tokens, newest, budget);
  if (!suffix) {
    return {
      kind: "retain-tail",
      compactThroughSeq: messages.length - 1,
      retainedFromSeq: messages.length,
      retainedTokenCount: 0,
    };
  }
  return {
    kind: "split-turn",
    compactThroughSeq: suffix.fromSeq - 1,
    retainedFromSeq: suffix.fromSeq,
    retainedTokenCount: suffix.tokens,
    splitTurn: {
      sourceTurn: { fromSeq: newest.fromSeq, toSeq: newest.toSeq },
      retainedSuffix: { fromSeq: suffix.fromSeq, toSeq: newest.toSeq },
    },
  };
}

export function checkpointSummarySystemPrompt(): string {
  return [
    "Summarize the compacted Loom node transcript into the fixed sections below.",
    "Preserve exact paths, identifiers, errors, pending approvals, and relevant tool/file activity.",
    "Do not invent facts. Keep the output bounded and model-readable.",
    "",
    ...CHECKPOINT_SUMMARY_SECTIONS.map((section) => `## ${section}`),
  ].join("\n");
}

export function serializeTranscriptForCheckpoint(
  messages: AgentMessage[],
  options: TranscriptSerializationOptions,
): SerializedCheckpointTranscript {
  const maxMessageChars = options.maxMessageChars ?? 4_000;
  const maxToolActivityChars = options.maxToolActivityChars ?? 1_000;
  const fromSeq = Math.max(0, options.fromSeq);
  const toSeq = Math.min(messages.length - 1, options.toSeq);
  const items: SerializedCheckpointMessage[] = [];
  const toolActivity: SerializedToolActivity[] = [];
  let truncated = false;

  for (let seq = fromSeq; seq <= toSeq; seq++) {
    const msg = messages[seq];
    if (!msg) continue;
    const role = roleOf(msg);
    const anyMsg = msg as any;
    const boundedMessage = boundText(textOf(msg), maxMessageChars);
    truncated = truncated || boundedMessage.truncated;
    items.push({
      seq,
      role,
      text: boundedMessage.text,
      truncated: boundedMessage.truncated,
      toolCallId: typeof anyMsg.toolCallId === "string" ? anyMsg.toolCallId : undefined,
      toolName: typeof anyMsg.toolName === "string" ? anyMsg.toolName : toolNameFromCalls(anyMsg),
    });

    if (role === "toolResult") {
      const boundedTool = boundText(textOf(msg), maxToolActivityChars);
      truncated = truncated || boundedTool.truncated;
      toolActivity.push({
        seq,
        toolCallId: typeof anyMsg.toolCallId === "string" ? anyMsg.toolCallId : `tool-${seq}`,
        toolName: typeof anyMsg.toolName === "string" ? anyMsg.toolName : "tool",
        text: boundedTool.text,
        truncated: boundedTool.truncated,
        paths: extractPaths(anyMsg).slice(0, 10),
      });
    }
  }

  return { range: { fromSeq, toSeq }, items, toolActivity, truncated };
}

export function buildCheckpointSummaryInput(input: {
  previousCheckpoint?: LoomContextCheckpointMessage;
  messages: AgentMessage[];
  range: LoomSourceRange;
  maxMessageChars?: number;
  maxToolActivityChars?: number;
}): CheckpointSummaryInput {
  return {
    systemPrompt: checkpointSummarySystemPrompt(),
    previousCheckpointSummary: input.previousCheckpoint?.summary,
    transcript: serializeTranscriptForCheckpoint(input.messages, {
      ...input.range,
      maxMessageChars: input.maxMessageChars,
      maxToolActivityChars: input.maxToolActivityChars,
    }),
  };
}

export function planFrozenBranchContext(input: FrozenBranchPlanInput): FrozenBranchPlan {
  const llmMessages: Message[] = input.ancestorMessages.filter(isLlmMessage);
  const tokenCounter = input.tokenCounter ?? ((msg: AgentMessage) => estimateMessageTokensUnbounded(msg));
  const tokens = llmMessages.map((msg, index) => Math.max(0, Math.round(tokenCounter(msg as AgentMessage, index))));
  const total = tokens.reduce((sum, value) => sum + value, 0);
  const budget = Math.max(0, Math.round(input.maxRawSnapshotTokens));
  const before = { tokens: total, exact: false };
  if (total <= budget) {
    return {
      kind: "raw-snapshot",
      rawSnapshot: llmMessages,
      diagnostics: { before, after: { tokens: total, exact: false } },
    };
  }

  const retained = newestSuffixWithinBudget(llmMessages, tokens, budget);
  const retainedTokens = retained.reduce((sum, item) => sum + item.tokens, 0);
  const retainedContext = retained.map((item) => item.message);
  const serialized = serializeTranscriptForCheckpoint(llmMessages as AgentMessage[], {
    fromSeq: 0,
    toSeq: Math.max(0, llmMessages.length - 1),
    maxMessageChars: 800,
    maxToolActivityChars: 400,
  });
  const summary = [
    "## Goal",
    "Frozen mounted-ancestor context for this child branch.",
    "## Constraints & Preferences",
    "This summary is immutable and child-owned; later parent messages or checkpoints must not affect it.",
    "## Progress",
    serialized.items.map((item) => `- ${item.seq} ${item.role}: ${item.text}`).join("\n"),
    "## Key Decisions",
    "- Preserve the retained recent ancestor context verbatim below.",
    "## Next Steps",
    "- Continue from the child seed and node-local transcript.",
    "## Critical Context",
    serialized.toolActivity.map((item) => `- ${item.toolName} ${item.toolCallId}: ${item.text}`).join("\n") || "- No bounded tool activity captured.",
  ].join("\n");
  const frozenSummary = createLoomFrozenBranchSummary({
    id: `frozen:${input.childNodeId}:${input.now}`,
    childNodeId: input.childNodeId,
    createdAt: input.now,
    source: {
      parentNodeId: input.parentNodeId,
      fingerprint: fingerprintMessages(llmMessages),
      fromSeq: 0,
      toSeq: Math.max(0, llmMessages.length - 1),
    },
    summary,
    retainedContext,
    diagnostics: { before, after: { tokens: retainedTokens + estimateTextTokens(summary), exact: false } },
  });
  return { kind: "frozen-summary", frozenSummary, diagnostics: frozenSummary.diagnostics };
}

function userTurns(messages: AgentMessage[], tokens: number[]): TurnRange[] {
  const turns: TurnRange[] = [];
  let start = -1;
  for (let i = 0; i < messages.length; i++) {
    if (roleOf(messages[i]!) !== "user") continue;
    if (start >= 0) turns.push(range(start, i - 1, tokens));
    start = i;
  }
  if (start >= 0) turns.push(range(start, messages.length - 1, tokens));
  return turns;
}

function range(fromSeq: number, toSeq: number, tokens: number[]): TurnRange {
  let total = 0;
  for (let i = fromSeq; i <= toSeq; i++) total += tokens[i] ?? 0;
  return { fromSeq, toSeq, tokens: total };
}

function suffixWithinBudget(tokens: number[], turn: TurnRange, budget: number): TurnRange | undefined {
  let total = 0;
  let fromSeq: number | undefined;
  for (let i = turn.toSeq; i >= turn.fromSeq; i--) {
    const next = total + (tokens[i] ?? 0);
    if (next > budget) break;
    total = next;
    if (total > 0) fromSeq = i;
  }
  return fromSeq === undefined ? undefined : { fromSeq, toSeq: turn.toSeq, tokens: total };
}

function newestSuffixWithinBudget<T extends AgentMessage>(messages: T[], tokens: number[], budget: number): Array<{ message: T; tokens: number }> {
  const out: Array<{ message: T; tokens: number }> = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokenCount = tokens[i] ?? 0;
    if (total + tokenCount > budget) break;
    out.unshift({ message: messages[i]!, tokens: tokenCount });
    total += tokenCount;
  }
  return out;
}

function estimateTextTokens(text: string): number {
  return Math.min(8192, Math.max(1, Math.round(text.length / 2)));
}

function fingerprintMessages(messages: AgentMessage[]): string {
  let hash = 2166136261;
  const input = JSON.stringify(messages);
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function boundText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const limit = Math.max(0, Math.round(maxChars));
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function toolNameFromCalls(msg: any): string | undefined {
  const call = Array.isArray(msg?.toolCalls) ? msg.toolCalls[0] : undefined;
  return typeof call?.name === "string" ? call.name : undefined;
}

function extractPaths(value: unknown): string[] {
  const paths: string[] = [];
  const visit = (item: unknown) => {
    if (paths.length >= 10) return;
    if (typeof item === "string") {
      if (/[/\\]/.test(item) && item.length <= 240) paths.push(item);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/path|file/i.test(key) && typeof child === "string" && child.length <= 240) paths.push(child);
      visit(child);
    }
  };
  visit(value);
  return [...new Set(paths)];
}
