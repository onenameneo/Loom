import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";

export const DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS = 200_000;
export const DEFAULT_TOOL_RESULT_PREVIEW_BYTES = 2_000;
export const TOOL_RESULTS_SUBDIR = "tool-results";

export interface ToolResultBudgetState {
  seenIds: Set<string>;
  replacements: Map<string, string>;
}

export interface ToolResultBudgetOptions {
  maxToolResultGroupChars?: number;
  skipToolNames?: Iterable<string>;
  referenceFor?: (message: ToolResultMessage, originalChars: number) => string;
  /** Persist before replacing. Return false to keep the original content. */
  persistResult?: (request: PersistedToolResultRequest) => boolean;
}

export interface PersistedToolResultRequest {
  toolCallId: string;
  toolName: string;
  path: string;
  content: string;
}

export interface ToolResultBudgetResult {
  messages: Message[];
  persistedResults: PersistedToolResultRequest[];
}

interface ToolResultItem {
  index: number;
  message: ToolResultMessage;
  toolCallId: string;
  toolName: string;
  originalText: string;
  originalChars: number;
  eligible: boolean;
  fresh: boolean;
}

export function createToolResultBudgetState(): ToolResultBudgetState {
  return { seenIds: new Set(), replacements: new Map() };
}

export function toolResultSidecarDir(userDataDir: string, sessionId: string): string {
  return join(userDataDir, "sessions", safePathSegment(sessionId), TOOL_RESULTS_SUBDIR);
}

export function toolResultSidecarPath(userDataDir: string, sessionId: string, toolCallId: string, extension: ".txt" | ".json" = ".txt"): string {
  return join(toolResultSidecarDir(userDataDir, sessionId), `${safePathSegment(toolCallId)}${extension}`);
}

export function toolResultSidecarPathForMessage(userDataDir: string, sessionId: string, message: ToolResultMessage): string {
  return toolResultSidecarPath(userDataDir, sessionId, message.toolCallId, sidecarExtensionFor(message));
}

export function applyToolResultBudget(
  messages: Message[],
  state: ToolResultBudgetState,
  options: ToolResultBudgetOptions = {},
): ToolResultBudgetResult {
  const maxChars = options.maxToolResultGroupChars ?? DEFAULT_MAX_TOOL_RESULT_GROUP_CHARS;
  const skipToolNames = new Set(options.skipToolNames ?? []);
  const out = [...messages];
  const persistedResults: PersistedToolResultRequest[] = [];

  forEachToolResultGroup(messages, (group, indexes) => {
    const items = group.map((message, offset) => {
      const index = indexes[offset]!;
      const replacement = state.replacements.get(message.toolCallId);
      if (replacement !== undefined) out[index] = replaceToolResultContent(message, replacement);
      return toItem(message, index, state, skipToolNames);
    });

    let groupChars = items.reduce((sum, item) => sum + (state.replacements.get(item.toolCallId)?.length ?? item.originalChars), 0);
    const freshItems = items.filter((item) => item.fresh);
    const candidates = freshItems
      .filter((item) => item.eligible)
      .sort((a, b) => b.originalChars - a.originalChars);

    if (groupChars > maxChars) {
      for (const item of candidates) {
        if (groupChars <= maxChars) break;
        const reference = options.referenceFor?.(item.message, item.originalChars) ?? `toolResult:${item.toolCallId}`;
        const request: PersistedToolResultRequest = {
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          path: reference.startsWith("toolResult:") ? "" : reference,
          content: serializeToolResultSidecarContent(item.message),
        };
        const replacement = buildReplacementText(item.message, {
          originalChars: item.originalChars,
          reference,
          content: request.content,
        });
        if (options.persistResult && !options.persistResult(request)) {
          state.seenIds.add(item.toolCallId);
          continue;
        }
        state.replacements.set(item.toolCallId, replacement);
        out[item.index] = replaceToolResultContent(item.message, replacement);
        persistedResults.push(request);
        groupChars = groupChars - item.originalChars + replacement.length;
      }
    }

    for (const item of freshItems) state.seenIds.add(item.toolCallId);
  });

  return { messages: out, persistedResults };
}

export function persistToolResultSidecars(requests: PersistedToolResultRequest[]): void {
  for (const request of requests) {
    tryPersistToolResultSidecar(request);
  }
}

/** Persist one sidecar and report whether the replacement is safe to expose. */
export function tryPersistToolResultSidecar(request: PersistedToolResultRequest): boolean {
  if (!request.path) return true;
  try {
    mkdirSync(dirname(request.path), { recursive: true });
    if (existsSync(request.path)) return true;
    writeFileSync(request.path, request.content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return true;
    return false;
  }
}

function forEachToolResultGroup(messages: Message[], visit: (group: ToolResultMessage[], indexes: number[]) => void): void {
  let group: ToolResultMessage[] = [];
  let indexes: number[] = [];
  const flush = () => {
    if (group.length === 0) return;
    visit(group, indexes);
    group = [];
    indexes = [];
  };

  messages.forEach((message, index) => {
    if (message.role === "toolResult") {
      group.push(message);
      indexes.push(index);
      return;
    }
    flush();
  });
  flush();
}

function toItem(message: ToolResultMessage, index: number, state: ToolResultBudgetState, skipToolNames: Set<string>): ToolResultItem {
  const originalText = toolResultVisibleText(message);
  const toolCallId = message.toolCallId;
  const toolName = message.toolName || "tool";
  return {
    index,
    message,
    toolCallId,
    toolName,
    originalText,
    originalChars: originalText.length,
    eligible: !skipToolNames.has(toolName) && message.content.every((part) => part.type === "text"),
    fresh: !state.seenIds.has(toolCallId) && !state.replacements.has(toolCallId),
  };
}

function buildReplacementText(message: ToolResultMessage, input: { originalChars: number; reference: string; content: string }): string {
  const preview = generateToolResultPreview(input.content, DEFAULT_TOOL_RESULT_PREVIEW_BYTES);
  return [
    "<persisted-tool-result>",
    "Tool result omitted from model context because the consecutive tool result group exceeded the configured budget.",
    `toolCallId: ${message.toolCallId}`,
    `toolName: ${message.toolName || "tool"}`,
    `originalChars: ${input.originalChars}`,
    `reason: tool_result_group_budget_exceeded`,
    `fullResult: ${input.reference}`,
    "Preview:",
    preview.text,
    ...(preview.hasMore ? ["..."] : []),
    "</persisted-tool-result>",
  ].join("\n");
}

/** Keep a bounded, newline-aware UTF-8 preview of the persisted payload. */
export function generateToolResultPreview(content: string, maxBytes = DEFAULT_TOOL_RESULT_PREVIEW_BYTES): { text: string; hasMore: boolean } {
  const limit = Math.max(0, Math.floor(maxBytes));
  if (Buffer.byteLength(content, "utf8") <= limit) return { text: content, hasMore: false };
  const truncated = sliceUtf8ByBytes(content, limit);
  const lastNewline = truncated.lastIndexOf("\n");
  const cutPoint = lastNewline > truncated.length * 0.5 ? lastNewline : truncated.length;
  return { text: truncated.slice(0, cutPoint), hasMore: true };
}

function sliceUtf8ByBytes(content: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of content) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return content.slice(0, end);
}

function replaceToolResultContent(message: ToolResultMessage, text: string): ToolResultMessage {
  const content: TextContent[] = [{ type: "text", text }];
  return { ...message, content };
}

function toolResultVisibleText(message: ToolResultMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`))
    .join("\n");
}

function sidecarExtensionFor(message: ToolResultMessage): ".txt" | ".json" {
  return message.content.length === 1 && message.content[0]?.type === "text" ? ".txt" : ".json";
}

export function serializeToolResultSidecarContent(message: ToolResultMessage): string {
  if (message.content.length === 1 && message.content[0]?.type === "text") return message.content[0].text;
  return JSON.stringify({
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content,
  }, null, 2);
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}
