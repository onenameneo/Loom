import type { TurnOperationKind } from "../ports";

export type TraceEntryKind = "turn" | "request" | "response" | "tool" | "approval" | "event" | "error";
export type TraceTerminalState = "running" | "completed" | "failed" | "aborted";
export type TraceValue = unknown;

export interface TraceEntry {
  sequence: number;
  at: number;
  kind: TraceEntryKind;
  payload: TraceValue;
}

export interface TraceRecord {
  nodeId: string;
  turnId: string;
  operation: TurnOperationKind;
  state: TraceTerminalState;
  startedAt: number;
  endedAt?: number;
  truncated?: boolean;
  entries: TraceEntry[];
}

export interface TraceSnapshot {
  nodeId: string;
  sequence: number;
  records: TraceRecord[];
}

export interface TraceRepository {
  start(input: { nodeId: string; turnId: string; operation: TurnOperationKind }): void;
  append(nodeId: string, turnId: string, kind: TraceEntryKind, payload: unknown): void;
  finish(nodeId: string, turnId: string, state: Exclude<TraceTerminalState, "running">): void;
  snapshot(nodeId: string): TraceSnapshot;
  subscribe(listener: (snapshot: TraceSnapshot) => void): () => void;
}

const SENSITIVE_KEY = /^(?:api[_-]?key|authorization|token|access[_-]?token|refresh[_-]?token|password|secret)$/i;

export function sanitizeTraceValue(value: unknown, options: { maxTextLength?: number } = {}, seen = new WeakSet<object>()): TraceValue {
  const maxTextLength = options.maxTextLength ?? 4_000;
  if (typeof value === "string") {
    return value.length <= maxTextLength ? value : { text: value.slice(0, maxTextLength), truncated: true };
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTraceValue(item, options, seen));
  const input = value as Record<string, unknown>;
  const record: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (input.type === "image" && key === "data" && typeof child === "string") {
      record[key] = { omitted: "binary", bytes: child.length };
      continue;
    }
    record[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeTraceValue(child, options, seen);
  }
  return record;
}

export function createTraceRepository(options: { maxCompletedPerNode?: number; maxEntriesPerRecord?: number; now?: () => number } = {}): TraceRepository {
  const maxCompletedPerNode = options.maxCompletedPerNode ?? 20;
  const maxEntriesPerRecord = options.maxEntriesPerRecord ?? 120;
  const now = options.now ?? Date.now;
  const recordsByNode = new Map<string, TraceRecord[]>();
  const sequenceByNode = new Map<string, number>();
  const listeners = new Set<(snapshot: TraceSnapshot) => void>();
  const next = (nodeId: string) => {
    const value = (sequenceByNode.get(nodeId) ?? 0) + 1;
    sequenceByNode.set(nodeId, value);
    return value;
  };
  const find = (nodeId: string, turnId: string) => recordsByNode.get(nodeId)?.find((record) => record.turnId === turnId);
  const snapshotFor = (nodeId: string): TraceSnapshot => {
    const records = recordsByNode.get(nodeId) ?? [];
    return { nodeId, sequence: sequenceByNode.get(nodeId) ?? 0, records: [...records].reverse() };
  };
  const publish = (nodeId: string) => {
    const snapshot = snapshotFor(nodeId);
    for (const listener of listeners) listener(snapshot);
  };
  const entry = (nodeId: string, record: TraceRecord, kind: TraceEntryKind, payload: unknown) => {
    if (record.entries.length >= maxEntriesPerRecord) {
      record.entries.shift();
      record.truncated = true;
    }
    record.entries.push({ sequence: next(nodeId), at: now(), kind, payload: sanitizeTraceValue(payload) });
  };
  return {
    start({ nodeId, turnId, operation }) {
      const record: TraceRecord = { nodeId, turnId, operation, state: "running", startedAt: now(), entries: [] };
      const records = recordsByNode.get(nodeId) ?? [];
      records.push(record);
      recordsByNode.set(nodeId, records);
      entry(nodeId, record, "turn", { state: "running", operation });
      publish(nodeId);
    },
    append(nodeId, turnId, kind, payload) {
      const record = find(nodeId, turnId);
      if (record) {
        entry(nodeId, record, kind, payload);
        publish(nodeId);
      }
    },
    finish(nodeId, turnId, state) {
      const record = find(nodeId, turnId);
      if (!record) return;
      record.state = state;
      record.endedAt = now();
      entry(nodeId, record, "turn", { state });
      const records = recordsByNode.get(nodeId) ?? [];
      const completed = records.filter((item) => item.state !== "running");
      while (completed.length > maxCompletedPerNode) {
        const oldest = completed.shift();
        const index = oldest ? records.indexOf(oldest) : -1;
        if (index >= 0) records.splice(index, 1);
      }
      publish(nodeId);
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
