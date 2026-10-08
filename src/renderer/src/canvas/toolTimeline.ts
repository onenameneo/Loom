import type { LiveTurnContentPart, ToolCanvasEventPayload } from "../env";

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
  contentParts?: LiveTurnContentPart[];
  images?: unknown[];
  artifacts?: unknown[];
  seq?: number;
  toolCall?: ToolCallView;
}

export type TurnTimelineRenderItem<T extends ToolTimelineMessage> =
  | { kind: "process"; key: string; messages: T[]; current: boolean }
  | { kind: "message"; message: T };

export function groupTurnTimelineMessages<T extends ToolTimelineMessage & { id: string | number }>(
  messages: T[],
): TurnTimelineRenderItem<T>[] {
  const items: TurnTimelineRenderItem<T>[] = [];
  let turn: T[] = [];
  let turnKey = messages[0]?.id;

  const flushTurn = (current: boolean) => {
    let lastTool = -1;
    turn.forEach((message, index) => {
      if (message.role === "tool" && message.toolCall) lastTool = index;
    });
    const process: Extract<TurnTimelineRenderItem<T>, { kind: "process" }> = {
      kind: "process", key: `process-${turnKey}`, messages: [], current,
    };
    const addProcess = (message: T) => {
      if (process.messages.length === 0) items.push(process);
      process.messages.push(message);
    };

    turn.forEach((message, index) => {
      if ((message.role === "tool" && message.toolCall) || message.role === "skill") {
        addProcess(message);
        return;
      }
      if (message.role !== "assistant") {
        items.push({ kind: "message", message });
        return;
      }

      const thinkingParts = message.contentParts?.filter((part) => part.kind === "thinking");
      const thinking = thinkingParts?.length
        ? thinkingParts.map((part) => part.text).join("")
        : message.thinking;
      const hasOutput = Boolean(message.text.trim() || message.contentParts?.some((part) => part.kind === "text" && part.text.trim()) || message.images?.length || message.artifacts?.length);
      if (!hasOutput && !thinking?.trim()) return;

      // The transcript has no final-answer flag. Text preceding a later tool
      // call is progress; text after the last tool stays readable, including questions.
      if (index < lastTool && !message.images?.length && !message.artifacts?.length) {
        addProcess(message);
        return;
      }
      if (thinking?.trim()) {
        addProcess({ ...message, text: "", thinking, contentParts: thinkingParts, images: undefined, artifacts: undefined, seq: hasOutput ? undefined : message.seq });
      }
      if (hasOutput) {
        items.push({ kind: "message", message: thinking?.trim()
          ? { ...message, thinking: undefined, contentParts: message.contentParts?.filter((part) => part.kind === "text") }
          : message });
      }
    });
    turn = [];
  };

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn(false);
      items.push({ kind: "message", message });
      turnKey = message.id;
    } else {
      turn.push(message);
    }
  }
  flushTurn(true);
  return items;
}

export function toolCallSubject(call: ToolCallView): string | undefined {
  if (!call.args || typeof call.args !== "object") return undefined;
  const args = call.args as Record<string, unknown>;
  for (const key of ["command", "pattern", "query", "path", "url"]) {
    if (typeof args[key] === "string" && args[key]) return args[key] as string;
  }
  return undefined;
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
