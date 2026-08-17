export interface FileMentionTrigger {
  start: number;
  end: number;
  query: string;
}

export function findFileMentionTrigger(value: string, cursor: number): FileMentionTrigger | null {
  if (cursor < 0 || cursor > value.length) return null;
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[1].length;
  return { start, end: cursor, query: match[2] ?? "" };
}
