import type { ToolCanvasEventPayload } from "../env";

export type ToolCallState = "start" | "update" | "end";

export interface ToolCallView {
  id: string;
  name: string;
  state: ToolCallState;
  isError: boolean;
  summary?: string;
  args?: unknown;
  details?: unknown;
  startedAt: number;
  updatedAt: number;
}

export function isToolCanvasEventPayload(payload: unknown): payload is ToolCanvasEventPayload {
  const p = payload as Partial<ToolCanvasEventPayload> | undefined;
  return (
    !!p &&
    (p.state === "start" || p.state === "update" || p.state === "end") &&
    typeof p.toolCallId === "string" &&
    typeof p.toolName === "string"
  );
}

export function applyToolEvent(
  calls: ToolCallView[],
  payload: ToolCanvasEventPayload,
  now = Date.now(),
): ToolCallView[] {
  const index = calls.findIndex((call) => call.id === payload.toolCallId);
  const current = index >= 0 ? calls[index] : undefined;
  const next: ToolCallView = {
    id: payload.toolCallId,
    name: payload.toolName,
    state: payload.state,
    isError: Boolean(payload.isError),
    summary: payload.summary ?? current?.summary,
    args: payload.args ?? current?.args,
    details: payload.details ?? current?.details,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  };
  if (index < 0) return [...calls, next];
  const copy = calls.slice();
  copy[index] = next;
  return copy;
}

export interface ToolTimelineMessage {
  role: string;
  text: string;
  thinking?: string;
  images?: unknown[];
  toolCall?: ToolCallView;
}

export type ToolTimelineRenderItem<T extends ToolTimelineMessage> =
  | { kind: "tools"; key: string; calls: ToolCallView[] }
  | { kind: "message"; message: T };

export function groupToolTimelineMessages<T extends ToolTimelineMessage & { id: string | number }>(
  messages: T[],
): ToolTimelineRenderItem<T>[] {
  const items: ToolTimelineRenderItem<T>[] = [];
  let pending: ToolCallView[] = [];
  let pendingKey: string | undefined;

  const flushTools = () => {
    if (pending.length === 0 || !pendingKey) return;
    items.push({ kind: "tools", key: pendingKey, calls: pending });
    pending = [];
    pendingKey = undefined;
  };

  for (const message of messages) {
    if (message.role === "assistant" && message.text.trim() === "" && !message.thinking?.trim() && !message.images?.length) {
      continue;
    }
    if (message.role === "tool" && message.toolCall) {
      pendingKey ??= `tools-${message.id}`;
      pending.push(message.toolCall);
      continue;
    }
    flushTools();
    items.push({ kind: "message", message });
  }
  flushTools();
  return items;
}

export function upsertToolTimelineMessage<T extends ToolTimelineMessage>(
  messages: T[],
  payload: ToolCanvasEventPayload,
  createMessage: (toolCall: ToolCallView) => T,
): T[] {
  const index = messages.findIndex((m) => m.role === "tool" && m.toolCall?.id === payload.toolCallId);
  const existingMessage = index >= 0 ? messages[index] : undefined;
  const existing = existingMessage?.toolCall ? [existingMessage.toolCall] : [];
  const [toolCall] = applyToolEvent(existing, payload);
  if (!toolCall) return messages;
  if (index >= 0) {
    const copy = messages.slice();
    copy[index] = { ...copy[index], text: toolCall.summary ?? copy[index].text, toolCall };
    return copy;
  }
  const last = messages.at(-1);
  const base = last?.role === "assistant" && last.text === "" && !last.thinking?.trim() ? messages.slice(0, -1) : messages;
  return [...base, createMessage(toolCall)];
}

export function clearToolTimeline() {
  return [] as ToolCallView[];
}
