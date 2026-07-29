export type TraceEntryDto = { sequence?: number; kind?: string; payload?: unknown };
export type TraceRecordDto = {
  turnId?: string;
  state?: string;
  operation?: string;
  entries?: TraceEntryDto[];
  [key: string]: unknown;
};
export type TraceSnapshotDto = { nodeId: string; sequence: number; records: TraceRecordDto[] };

function entryKey(entry: TraceEntryDto, index: number) {
  return typeof entry.sequence === "number" ? `${entry.sequence}:${entry.kind ?? ""}` : `index:${index}:${entry.kind ?? ""}`;
}

function mergeEntries(current: TraceEntryDto[] = [], incoming: TraceEntryDto[] = []) {
  const merged = new Map<string, TraceEntryDto>();
  current.forEach((entry, index) => merged.set(entryKey(entry, index), entry));
  incoming.forEach((entry, index) => merged.set(entryKey(entry, index), entry));
  return [...merged.values()].sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
}

function mergeRecords(current: TraceRecordDto[] = [], incoming: TraceRecordDto[] = []) {
  if (!incoming.length) return incoming;
  const currentByTurnId = new Map(current.flatMap((record) => record.turnId ? [[record.turnId, record] as const] : []));
  const incomingTurnIds = new Set(incoming.flatMap((record) => record.turnId ? [record.turnId] : []));
  const mergedIncoming = incoming.map((record) => {
    const previous = record.turnId ? currentByTurnId.get(record.turnId) : undefined;
    return previous ? { ...previous, ...record, entries: mergeEntries(previous.entries, record.entries) } : record;
  });
  const remainingCurrent = current.filter((record) => !record.turnId || !incomingTurnIds.has(record.turnId));
  return [...mergedIncoming, ...remainingCurrent];
}

export function acceptTraceSnapshot(
  current: TraceSnapshotDto | null,
  incoming: TraceSnapshotDto,
  focusedNodeId: string,
): TraceSnapshotDto | null {
  if (incoming.nodeId !== focusedNodeId) return current;
  if (current && incoming.sequence < current.sequence) return current;
  if (!current) return incoming;
  return { ...incoming, records: mergeRecords(current.records, incoming.records) };
}
