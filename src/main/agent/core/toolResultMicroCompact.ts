import type { Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { PersistedToolResultRequest } from "./toolResultBudget";

export const DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES = 60;
export const DEFAULT_TOOL_RESULT_MICROCOMPACT_KEEP_RECENT = 5;

export interface ToolResultMicroCompactState {
  replacements: Map<string, string>;
}

export interface ToolResultMicroCompactOptions {
  now: number;
  sourceMessages: ReadonlyArray<unknown>;
  enabled?: boolean;
  idleGapMinutes?: number;
  keepRecentToolResults?: number;
  skipToolNames?: Iterable<string>;
  referenceFor?: (message: ToolResultMessage, originalChars: number) => string;
}

export interface ToolResultMicroCompactDiagnostics {
  trigger: "time_idle";
  idleGapMinutes: number;
  retainedCount: number;
  replacedCount: number;
  estimatedCharsSaved: number;
}

export interface ToolResultMicroCompactResult {
  messages: Message[];
  persistedResults: PersistedToolResultRequest[];
  diagnostics?: ToolResultMicroCompactDiagnostics;
}

interface Candidate {
  index: number;
  message: ToolResultMessage;
  originalText: string;
  originalChars: number;
}

export function createToolResultMicroCompactState(): ToolResultMicroCompactState {
  return { replacements: new Map() };
}

export function applyToolResultMicroCompact(
  messages: Message[],
  state: ToolResultMicroCompactState,
  options: ToolResultMicroCompactOptions,
): ToolResultMicroCompactResult {
  if (options.enabled === false) return { messages, persistedResults: [] };

  const out = [...messages];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message?.role !== "toolResult") continue;
    const replacement = state.replacements.get(message.toolCallId);
    if (replacement !== undefined) out[index] = replaceToolResultContent(message, replacement);
  }

  const trigger = evaluateIdleTrigger(options.sourceMessages, options.now, options.idleGapMinutes ?? DEFAULT_TOOL_RESULT_MICROCOMPACT_IDLE_GAP_MINUTES);
  if (!trigger) return { messages: out, persistedResults: [] };

  const skipToolNames = new Set(options.skipToolNames ?? []);
  const candidates = messages.flatMap((message, index): Candidate[] => {
    if (message.role !== "toolResult") return [];
    if (state.replacements.has(message.toolCallId)) return [];
    if (skipToolNames.has(message.toolName || "tool")) return [];
    if (!message.content.every((part) => part.type === "text")) return [];
    const originalText = toolResultVisibleText(message);
    return [{ index, message, originalText, originalChars: originalText.length }];
  });

  const keepRecent = Math.max(1, Math.round(options.keepRecentToolResults ?? DEFAULT_TOOL_RESULT_MICROCOMPACT_KEEP_RECENT));
  const replaceUntil = Math.max(0, candidates.length - keepRecent);
  if (replaceUntil === 0) return { messages: out, persistedResults: [] };

  const persistedResults: PersistedToolResultRequest[] = [];
  let originalChars = 0;
  let replacementChars = 0;

  for (const candidate of candidates.slice(0, replaceUntil)) {
    const reference = options.referenceFor?.(candidate.message, candidate.originalChars) ?? `toolResult:${candidate.message.toolCallId}`;
    const replacement = buildReplacementText(candidate.message, {
      originalChars: candidate.originalChars,
      reference,
    });
    state.replacements.set(candidate.message.toolCallId, replacement);
    out[candidate.index] = replaceToolResultContent(candidate.message, replacement);
    originalChars += candidate.originalChars;
    replacementChars += replacement.length;
    persistedResults.push({
      toolCallId: candidate.message.toolCallId,
      toolName: candidate.message.toolName || "tool",
      path: reference.startsWith("toolResult:") ? "" : reference,
      content: candidate.originalText,
    });
  }

  return {
    messages: out,
    persistedResults,
    diagnostics: {
      trigger: "time_idle",
      idleGapMinutes: trigger.idleGapMinutes,
      retainedCount: Math.min(keepRecent, candidates.length),
      replacedCount: persistedResults.length,
      estimatedCharsSaved: Math.max(0, originalChars - replacementChars),
    },
  };
}

function evaluateIdleTrigger(sourceMessages: ReadonlyArray<unknown>, now: number, idleGapMinutes: number): { idleGapMinutes: number } | undefined {
  const newestAssistant = [...sourceMessages].reverse().find((message) => roleOf(message) === "assistant");
  if (!newestAssistant) return undefined;
  const timestamp = timestampOf(newestAssistant);
  if (timestamp === undefined) return undefined;
  const gapMinutes = (now - timestamp) / 60_000;
  if (!Number.isFinite(gapMinutes) || gapMinutes < idleGapMinutes) return undefined;
  return { idleGapMinutes: Math.floor(gapMinutes) };
}

function roleOf(message: unknown): string | undefined {
  return typeof (message as any)?.role === "string" ? (message as any).role : undefined;
}

function timestampOf(message: unknown): number | undefined {
  const timestamp = (message as any)?.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildReplacementText(message: ToolResultMessage, input: { originalChars: number; reference: string }): string {
  return [
    "<micro-compacted-tool-result>",
    "Old tool result content omitted from this model context because the node was idle and the result is stale.",
    `toolCallId: ${message.toolCallId}`,
    `toolName: ${message.toolName || "tool"}`,
    `originalChars: ${input.originalChars}`,
    `reason: stale_tool_result_microcompact`,
    `fullResult: ${input.reference}`,
    "</micro-compacted-tool-result>",
  ].join("\n");
}

function replaceToolResultContent(message: ToolResultMessage, text: string): ToolResultMessage {
  const content: TextContent[] = [{ type: "text", text }];
  return { ...message, content };
}

function toolResultVisibleText(message: ToolResultMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}
