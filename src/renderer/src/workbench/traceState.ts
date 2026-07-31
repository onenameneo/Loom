export type TraceEntryDto = { sequence?: number; kind?: string; payload?: unknown };
export type TraceRecordDto = {
  turnId?: string;
  state?: string;
  operation?: string;
  entries?: TraceEntryDto[];
  [key: string]: unknown;
};
export type TraceSnapshotDto = { nodeId: string; sequence: number; records: TraceRecordDto[] };

export function acceptTraceSnapshot(
  current: TraceSnapshotDto | null,
  incoming: TraceSnapshotDto,
  focusedNodeId: string,
): TraceSnapshotDto | null {
  if (incoming.nodeId !== focusedNodeId) return current;
  if (current && incoming.sequence < current.sequence) return current;
  return incoming;
}
