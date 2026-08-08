import type { TurnOperationKind } from "../ports";

export type TraceSpanKind = "turn" | "llm_call" | "tool" | "compaction";
export type TraceSpanStatus = "pending" | "ok" | "error" | "aborted";

/** 一个 span = 一次有边界的观测单元（turn 根 / 模型调用 / 工具执行 / 压缩）。 */
export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  kind: TraceSpanKind;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: TraceSpanStatus;
  attributes: Record<string, unknown>;
}

export interface TraceRecord {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  /** 运行中为 pending；finishTurn 后为 ok/error/aborted。 */
  status: TraceSpanStatus;
  startedAt: number;
  endedAt?: number;
  truncated?: boolean;
  spans: TraceSpan[];
}

export interface TraceSnapshot {
  nodeId: string;
  revision: number;
  records: TraceRecord[];
}

/** 增量发布事件；revision 为 per-node 单调递增，renderer 按此门控。 */
export type TraceEvent =
  | { type: "turn_start"; nodeId: string; turnId: string; operation: TurnOperationKind; revision: number; startedAt: number; span: TraceSpan }
  | { type: "span"; nodeId: string; turnId: string; span: TraceSpan; revision: number }
  | { type: "span_end"; nodeId: string; turnId: string; spanId: string; status: TraceSpanStatus; endedAt: number; attributes?: Record<string, unknown>; revision: number }
  | { type: "turn_update"; nodeId: string; turnId: string; attributes: Record<string, unknown>; revision: number }
  | { type: "turn_end"; nodeId: string; turnId: string; status: Exclude<TraceSpanStatus, "pending">; endedAt: number; revision: number };

export interface TraceRepository {
  startTurn(input: { nodeId: string; turnId: string; operation: TurnOperationKind }): void;
  beginSpan(input: {
    nodeId: string;
    turnId: string;
    parentSpanId?: string;
    kind: TraceSpanKind;
    name: string;
    attributes?: Record<string, unknown>;
  }): string | undefined;
  endSpan(
    nodeId: string,
    turnId: string,
    spanId: string,
    input: { status: TraceSpanStatus; endedAt?: number; attributes?: Record<string, unknown> },
  ): void;
  updateTurn(nodeId: string, turnId: string, attributes: Record<string, unknown>): void;
  finishTurn(nodeId: string, turnId: string, status: Exclude<TraceSpanStatus, "pending">): void;
  snapshot(nodeId: string): TraceSnapshot;
  subscribe(listener: (event: TraceEvent) => void): () => void;
}

const SENSITIVE_KEY = /^(?:api[_-]?key|authorization|token|access[_-]?token|refresh[_-]?token|password|secret)$/i;

export function sanitizeTraceValue(
  value: unknown,
  options: { maxTextLength?: number; maxArrayLength?: number; maxObjectKeys?: number; maxDepth?: number } = {},
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  const maxTextLength = options.maxTextLength ?? 1_500;
  const maxArrayLength = options.maxArrayLength ?? 30;
  const maxObjectKeys = options.maxObjectKeys ?? 40;
  const maxDepth = options.maxDepth ?? 5;
  if (typeof value === "string") {
    return value.length <= maxTextLength ? value : { text: value.slice(0, maxTextLength), truncated: true };
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return String(value);
  if (depth >= maxDepth) return { truncated: "depth" };
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const head = value.slice(0, maxArrayLength).map((item) => sanitizeTraceValue(item, options, seen, depth + 1));
    return value.length > maxArrayLength ? [...head, { omitted: value.length - maxArrayLength }] : head;
  }
  const input = value as Record<string, unknown>;
  const record: Record<string, unknown> = {};
  const entries = Object.entries(input);
  for (const [key, child] of entries.slice(0, maxObjectKeys)) {
    if (input.type === "image" && key === "data" && typeof child === "string") {
      record[key] = { omitted: "binary", bytes: child.length };
      continue;
    }
    record[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeTraceValue(child, options, seen, depth + 1);
  }
  if (entries.length > maxObjectKeys) record.__omittedKeys = entries.length - maxObjectKeys;
  return record;
}

function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = sanitizeTraceValue(value);
  }
  return out;
}

export function createTraceRepository(options: { maxCompletedPerNode?: number; maxSpansPerRecord?: number; now?: () => number } = {}): TraceRepository {
  const maxCompletedPerNode = options.maxCompletedPerNode ?? 20;
  const maxSpansPerRecord = options.maxSpansPerRecord ?? 120;
  const now = options.now ?? Date.now;
  const recordsByNode = new Map<string, TraceRecord[]>();
  const revisionByNode = new Map<string, number>();
  const listeners = new Set<(event: TraceEvent) => void>();
  let spanSeq = 0;

  const nextRevision = (nodeId: string) => {
    const value = (revisionByNode.get(nodeId) ?? 0) + 1;
    revisionByNode.set(nodeId, value);
    return value;
  };
  const findRecord = (nodeId: string, turnId: string) => recordsByNode.get(nodeId)?.find((record) => record.turnId === turnId);
  const findSpan = (record: TraceRecord, spanId: string) => record.spans.find((span) => span.spanId === spanId);
  const rootSpanId = (record: TraceRecord) => record.spans.find((span) => span.kind === "turn")?.spanId;
  const snapshotFor = (nodeId: string): TraceSnapshot => {
    const records = recordsByNode.get(nodeId) ?? [];
    return { nodeId, revision: revisionByNode.get(nodeId) ?? 0, records: [...records].reverse() };
  };
  const publish = (event: TraceEvent) => {
    for (const listener of listeners) listener(event);
  };
  const appendSpan = (record: TraceRecord, span: TraceSpan) => {
    if (record.spans.length >= maxSpansPerRecord) {
      record.spans.shift();
      record.truncated = true;
    }
    record.spans.push(span);
  };

  return {
    startTurn({ nodeId, turnId, operation }) {
      const revision = nextRevision(nodeId);
      const span: TraceSpan = {
        spanId: `span-${++spanSeq}`,
        kind: "turn",
        name: operation,
        startedAt: now(),
        status: "pending",
        attributes: { operation },
      };
      const record: TraceRecord = { nodeId, turnId, operation, status: "pending", startedAt: span.startedAt, spans: [span] };
      const records = recordsByNode.get(nodeId) ?? [];
      records.push(record);
      recordsByNode.set(nodeId, records);
      publish({ type: "turn_start", nodeId, turnId, operation, revision, startedAt: span.startedAt, span });
    },
    beginSpan({ nodeId, turnId, parentSpanId, kind, name, attributes = {} }) {
      const record = findRecord(nodeId, turnId);
      if (!record) return undefined;
      const revision = nextRevision(nodeId);
      const span: TraceSpan = {
        spanId: `span-${++spanSeq}`,
        parentSpanId: parentSpanId ?? rootSpanId(record),
        kind,
        name,
        startedAt: now(),
        status: "pending",
        attributes: sanitizeAttributes(attributes),
      };
      appendSpan(record, span);
      publish({ type: "span", nodeId, turnId, span, revision });
      return span.spanId;
    },
    endSpan(nodeId, turnId, spanId, { status, endedAt, attributes }) {
      const record = findRecord(nodeId, turnId);
      const span = record ? findSpan(record, spanId) : undefined;
      if (!record || !span) return;
      const revision = nextRevision(nodeId);
      span.status = status;
      span.endedAt = endedAt ?? now();
      if (attributes && Object.keys(attributes).length > 0) {
        span.attributes = { ...span.attributes, ...sanitizeAttributes(attributes) };
      }
      publish({ type: "span_end", nodeId, turnId, spanId, status, endedAt: span.endedAt, attributes: span.attributes, revision });
    },
    updateTurn(nodeId, turnId, attributes) {
      const record = findRecord(nodeId, turnId);
      const span = record ? findSpan(record, rootSpanId(record) ?? "") : undefined;
      if (!span) return;
      const revision = nextRevision(nodeId);
      span.attributes = { ...span.attributes, ...sanitizeAttributes(attributes) };
      publish({ type: "turn_update", nodeId, turnId, attributes: span.attributes, revision });
    },
    finishTurn(nodeId, turnId, status) {
      const record = findRecord(nodeId, turnId);
      if (!record) return;
      const revision = nextRevision(nodeId);
      record.status = status;
      record.endedAt = now();
      const root = findSpan(record, rootSpanId(record) ?? "");
      if (root) {
        root.status = status;
        root.endedAt = record.endedAt;
      }
      // 兜底：未 end 的 span 标 aborted（崩溃/中断路径），保持树一致。
      for (const span of record.spans) {
        if (span.endedAt === undefined) {
          span.status = "aborted";
          span.endedAt = record.endedAt;
        }
      }
      const completed = recordsByNode.get(nodeId) ?? [];
      const done = completed.filter((item) => item.endedAt !== undefined);
      while (done.length > maxCompletedPerNode) {
        const oldest = done.shift();
        const index = oldest ? completed.indexOf(oldest) : -1;
        if (index >= 0) completed.splice(index, 1);
      }
      publish({ type: "turn_end", nodeId, turnId, status, endedAt: record.endedAt, revision });
    },
    snapshot(nodeId) {
      return snapshotFor(nodeId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
