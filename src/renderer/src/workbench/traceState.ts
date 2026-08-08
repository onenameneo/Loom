// Trace 客户端状态：主进程发增量事件（TraceEventDto），renderer 本地累积并按 revision 门控。
// 与 liveTurnBridge 同理：先订阅再取初始快照，避免丢事件。

export type TraceSpanDto = {
  spanId: string;
  parentSpanId?: string;
  kind: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  attributes: Record<string, unknown>;
};

export type TraceRecordDto = {
  nodeId: string;
  turnId: string;
  operation: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  truncated?: boolean;
  spans: TraceSpanDto[];
};

export type TraceSnapshotDto = { nodeId: string; revision: number; records: TraceRecordDto[] };

export type TraceEventDto =
  | { type: "turn_start"; nodeId: string; turnId: string; operation: string; revision: number; startedAt: number; span: TraceSpanDto }
  | { type: "span"; nodeId: string; turnId: string; span: TraceSpanDto; revision: number }
  | { type: "span_end"; nodeId: string; turnId: string; spanId: string; status: string; endedAt: number; attributes?: Record<string, unknown>; revision: number }
  | { type: "turn_update"; nodeId: string; turnId: string; attributes: Record<string, unknown>; revision: number }
  | { type: "turn_end"; nodeId: string; turnId: string; status: string; endedAt: number; revision: number };

export interface TraceClientState {
  nodeId: string;
  revision: number;
  recordsByTurnId: Record<string, TraceRecordDto>;
  /** turnIds 按开始顺序，展示时反转为 newest-first。 */
  order: string[];
}

export function traceSnapshotToState(snapshot: TraceSnapshotDto): TraceClientState {
  const recordsByTurnId: Record<string, TraceRecordDto> = {};
  const order: string[] = [];
  for (const record of snapshot.records) {
    recordsByTurnId[record.turnId] = record;
    order.push(record.turnId);
  }
  return { nodeId: snapshot.nodeId, revision: snapshot.revision, recordsByTurnId, order };
}

function replaceRecord(state: TraceClientState, turnId: string, record: TraceRecordDto): TraceClientState {
  return { ...state, recordsByTurnId: { ...state.recordsByTurnId, [turnId]: record } };
}

function updateSpan(record: TraceRecordDto, spanId: string, patch: Partial<TraceSpanDto>): TraceRecordDto {
  return {
    ...record,
    spans: record.spans.map((span) => (span.spanId === spanId ? { ...span, ...patch } : span)),
  };
}

/** 应用一个增量事件；revision 不高于当前或 node 不匹配时忽略（返回原状态）。 */
export function applyTraceEvent(
  current: TraceClientState | null,
  event: TraceEventDto,
  focusedNodeId: string,
): TraceClientState | null {
  if (event.nodeId !== focusedNodeId) return current;
  if (current && event.revision <= current.revision) return current;
  const next: TraceClientState = current
    ? { ...current, revision: event.revision }
    : { nodeId: focusedNodeId, revision: 0, recordsByTurnId: {}, order: [] };

  switch (event.type) {
    case "turn_start": {
      if (next.recordsByTurnId[event.turnId]) return next;
      const record: TraceRecordDto = {
        nodeId: event.nodeId,
        turnId: event.turnId,
        operation: event.operation,
        status: "pending",
        startedAt: event.startedAt,
        spans: [event.span],
      };
      return { ...next, recordsByTurnId: { ...next.recordsByTurnId, [event.turnId]: record }, order: [...next.order, event.turnId] };
    }
    case "span": {
      const record = next.recordsByTurnId[event.turnId];
      if (!record || record.spans.some((span) => span.spanId === event.span.spanId)) return next;
      return replaceRecord(next, event.turnId, { ...record, spans: [...record.spans, event.span] });
    }
    case "span_end": {
      const record = next.recordsByTurnId[event.turnId];
      if (!record) return next;
      const patch: Partial<TraceSpanDto> = { status: event.status, endedAt: event.endedAt };
      if (event.attributes) patch.attributes = event.attributes;
      return replaceRecord(next, event.turnId, updateSpan(record, event.spanId, patch));
    }
    case "turn_update": {
      const record = next.recordsByTurnId[event.turnId];
      if (!record || record.spans.length === 0) return next;
      const root = record.spans[0];
      return replaceRecord(
        next,
        event.turnId,
        updateSpan(record, root.spanId, { attributes: event.attributes }),
      );
    }
    case "turn_end": {
      const record = next.recordsByTurnId[event.turnId];
      if (!record || record.spans.length === 0) return next;
      const root = record.spans[0];
      return replaceRecord(
        next,
        event.turnId,
        {
          ...record,
          status: event.status,
          endedAt: event.endedAt,
          spans: record.spans.map((span) =>
            span.spanId === root.spanId ? { ...span, status: event.status, endedAt: event.endedAt } : span,
          ),
        },
      );
    }
    default:
      return next;
  }
}

export interface TraceSpanNode extends TraceSpanDto {
  children: TraceSpanNode[];
}

/** 把扁平 spans[] 投影为嵌套树（按 parentSpanId）；缺省/悬空的 parent 归为根。 */
export function buildSpanTree(spans: TraceSpanDto[]): TraceSpanNode[] {
  const byId = new Map<string, TraceSpanNode>();
  for (const span of spans) byId.set(span.spanId, { ...span, children: [] });
  const roots: TraceSpanNode[] = [];
  for (const span of spans) {
    const node = byId.get(span.spanId);
    if (!node) continue;
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
