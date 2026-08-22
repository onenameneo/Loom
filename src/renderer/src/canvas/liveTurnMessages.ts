import type { LiveTurnContentPart, LiveTurnSnapshot } from "../env";

export interface LiveTurnMessageLike {
  role: string;
  text: string;
  thinking?: string;
  contentParts?: LiveTurnContentPart[];
}

function cumulativeSuffix(next: string, rendered: string): string {
  if (!next) return "";
  // A live snapshot is cumulative. If it does not extend what is already
  // rendered, it is stale or belongs to a reset turn; appending it would
  // duplicate content. The next authoritative reload can resynchronize it.
  return next.startsWith(rendered) ? next.slice(rendered.length) : "";
}

function snapshotParts(snapshot: LiveTurnSnapshot): LiveTurnContentPart[] {
  if (snapshot.contentParts?.length) return snapshot.contentParts;
  const parts: LiveTurnContentPart[] = [];
  if (snapshot.assistantThinking) parts.push({ partId: `${snapshot.turnId}:legacy:thinking`, kind: "thinking", text: snapshot.assistantThinking, sequence: 1 });
  if (snapshot.assistantText) parts.push({ partId: `${snapshot.turnId}:legacy:text`, kind: "text", text: snapshot.assistantText, sequence: parts.length + 1 });
  return parts;
}

function messageParts(message: LiveTurnMessageLike, index: number): LiveTurnContentPart[] {
  if (message.contentParts?.length) return message.contentParts;
  const parts: LiveTurnContentPart[] = [];
  if (message.thinking) parts.push({ partId: `legacy:${index}:thinking`, kind: "thinking", text: message.thinking, sequence: 1 });
  if (message.text) parts.push({ partId: `legacy:${index}:text`, kind: "text", text: message.text, sequence: parts.length + 1 });
  return parts;
}

function contentPartSuffix(next: LiveTurnContentPart[], rendered: LiveTurnContentPart[]): LiveTurnContentPart[] | undefined {
  if (rendered.length === 0) return next;
  if (next.length < rendered.length) return undefined;
  const suffix: LiveTurnContentPart[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const current = next[index];
    const previous = rendered[index];
    if (previous) {
      if (current.partId !== previous.partId || current.kind !== previous.kind || !current.text.startsWith(previous.text)) return undefined;
      const delta = current.text.slice(previous.text.length);
      if (delta) suffix.push({ ...current, text: delta });
    } else {
      suffix.push(current);
    }
  }
  return suffix;
}

function appendContentParts(existing: LiveTurnContentPart[] | undefined, suffix: LiveTurnContentPart[]): LiveTurnContentPart[] | undefined {
  if (!existing && suffix.length === 0) return undefined;
  const parts = [...(existing ?? [])].map((part) => ({ ...part }));
  for (const part of suffix) {
    const last = parts[parts.length - 1];
    if (last?.partId === part.partId && last.kind === part.kind) last.text += part.text;
    else parts.push({ ...part });
  }
  return parts;
}

/**
 * Live-turn snapshots contain cumulative assistant text. Tool events are
 * inserted between assistant segments, so only the suffix not already
 * rendered after the latest user message may be appended.
 */
export function appendLiveTurnMessage<T extends LiveTurnMessageLike>(
  messages: T[],
  snapshot: LiveTurnSnapshot,
  createAssistant: (text: string, thinking?: string, contentParts?: LiveTurnContentPart[]) => T,
): T[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const turnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
  const assistantMessages = turnMessages.filter((message) => message.role === "assistant");
  const renderedText = assistantMessages.map((message) => message.text).join("");
  const renderedThinking = assistantMessages.map((message) => message.thinking ?? "").join("");
  const renderedParts = assistantMessages.flatMap((message, index) => messageParts(message, index));
  const nextParts = snapshotParts(snapshot);
  const hasStructuredRendered = assistantMessages.length === 0 || assistantMessages.every((message) => Boolean(message.contentParts?.length));
  const parts = hasStructuredRendered ? contentPartSuffix(nextParts, renderedParts) : undefined;
  const text = parts === undefined
    ? cumulativeSuffix(snapshot.assistantText, renderedText)
    : parts.filter((part) => part.kind === "text").map((part) => part.text).join("");
  const thinking = parts === undefined
    ? cumulativeSuffix(snapshot.assistantThinking ?? "", renderedThinking)
    : parts.filter((part) => part.kind === "thinking").map((part) => part.text).join("");
  if (parts === undefined && snapshot.contentParts?.length && renderedParts.length > 0) {
    const last = messages.at(-1);
    if (last?.role === "assistant") {
      return [
        ...messages.slice(0, -1),
        { ...last, text: snapshot.assistantText, thinking: snapshot.assistantThinking, contentParts: nextParts },
      ];
    }
    const replacement = createAssistant(snapshot.assistantText, snapshot.assistantThinking, nextParts);
    return [...messages, nextParts.length > 0 && !replacement.contentParts ? { ...replacement, contentParts: nextParts } : replacement];
  }
  if (parts === undefined && renderedParts.length > 0) return messages;
  if (!text && !thinking) return messages;

  const last = messages.at(-1);
  if (last?.role === "assistant") {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        text: `${last.text}${text}`,
        thinking: `${last.thinking ?? ""}${thinking}` || undefined,
        contentParts: appendContentParts(last.contentParts, parts ?? []),
      },
    ];
  }
  const created = createAssistant(text, thinking || undefined, parts);
  return [...messages, parts && parts.length > 0 && !created.contentParts ? { ...created, contentParts: parts } : created];
}
