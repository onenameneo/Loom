export type MemoryRecordType = "user" | "feedback" | "project" | "reference";
export type MemoryRecordStatus = "active" | "candidate" | "rejected" | "archived" | "stale" | "conflicted";

export type MemoryRecord = {
  id: string;
  type: MemoryRecordType;
  scope: { kind: "user" } | { kind: "project"; projectId: string };
  status: MemoryRecordStatus;
  confidence: number;
  description: string;
  content: string;
  source: { trigger: string; sessionId?: string; nodeId?: string; excerpt?: string };
  createdAt?: number;
  updatedAt: number;
  supersedes?: string[];
  archivedReason?: string;
};

export type MemoryStats = {
  active: number;
  candidates: number;
  archived: number;
  stale: number;
  conflicted: number;
  issues: number;
};

export type MemoryFilter = "all" | "candidate" | "active" | "archived";

export type AutoDreamStatus = {
  status?: "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "checking";
  phase?: string;
  progress?: number;
  newSessions?: number;
  changedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  lastError?: string;
  gate?: { eligible: boolean; reason: "disabled" | "interval" | "sessions" | "throttled" | "locked" | "ready"; nextEligibleAt?: number };
};

const RECORD_TYPES: MemoryRecordType[] = ["user", "feedback", "project", "reference"];
const RECORD_STATUSES: MemoryRecordStatus[] = ["active", "candidate", "rejected", "archived", "stale", "conflicted"];

function isRecordType(value: unknown): value is MemoryRecordType {
  return typeof value === "string" && RECORD_TYPES.includes(value as MemoryRecordType);
}

function isRecordStatus(value: unknown): value is MemoryRecordStatus {
  return typeof value === "string" && RECORD_STATUSES.includes(value as MemoryRecordStatus);
}

export function normalizeMemoryRecord(value: unknown): MemoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const scope = item.scope;
  const source = item.source;
  if (
    typeof item.id !== "string" ||
    !isRecordType(item.type) ||
    !isRecordStatus(item.status) ||
    typeof item.description !== "string" ||
    typeof item.content !== "string" ||
    typeof item.confidence !== "number" ||
    typeof item.updatedAt !== "number" ||
    !scope || typeof scope !== "object" ||
    !source || typeof source !== "object"
  ) return null;
  const rawScope = scope as Record<string, unknown>;
  const normalizedScope = rawScope.kind === "project" && typeof rawScope.projectId === "string"
    ? { kind: "project" as const, projectId: rawScope.projectId }
    : rawScope.kind === "user" ? { kind: "user" as const } : null;
  if (!normalizedScope) return null;
  const rawSource = source as Record<string, unknown>;
  return {
    id: item.id,
    type: item.type,
    scope: normalizedScope,
    status: item.status,
    confidence: Math.max(0, Math.min(1, item.confidence)),
    description: item.description,
    content: item.content,
    source: {
      trigger: typeof rawSource.trigger === "string" ? rawSource.trigger : "unknown",
      ...(typeof rawSource.sessionId === "string" ? { sessionId: rawSource.sessionId } : {}),
      ...(typeof rawSource.nodeId === "string" ? { nodeId: rawSource.nodeId } : {}),
      ...(typeof rawSource.excerpt === "string" ? { excerpt: rawSource.excerpt } : {}),
    },
    ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
    updatedAt: item.updatedAt,
    ...(Array.isArray(item.supersedes) ? { supersedes: item.supersedes.filter((id): id is string => typeof id === "string") } : {}),
    ...(typeof item.archivedReason === "string" ? { archivedReason: item.archivedReason } : {}),
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeMemoryListResult(value: unknown): { records: MemoryRecord[]; issues: Array<{ path: string; message: string }>; stats: MemoryStats } {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawRecords = Array.isArray(result.records) ? result.records : [];
  const normalizedRecords: MemoryRecord[] = [];
  const invalidIndices: number[] = [];
  rawRecords.forEach((item, index) => {
    const normalized = normalizeMemoryRecord(item);
    if (normalized) normalizedRecords.push(normalized);
    else invalidIndices.push(index);
  });
  const rawIssues = Array.isArray(result.issues) ? result.issues as unknown[] : [];
  const issues: Array<{ path: string; message: string }> = rawIssues
    .filter((issue): issue is { path: string; message: string } => Boolean(issue && typeof issue === "object" && typeof (issue as any).path === "string" && typeof (issue as any).message === "string"));
  return {
    records: normalizedRecords,
    issues: [...issues, ...invalidIndices.map((index) => ({ path: `records[${index}]`, message: "Invalid memory record" }))],
    stats: {
      active: count((result.stats as any)?.active),
      candidates: count((result.stats as any)?.candidates),
      archived: count((result.stats as any)?.archived),
      stale: count((result.stats as any)?.stale),
      conflicted: count((result.stats as any)?.conflicted),
      issues: count((result.stats as any)?.issues) + invalidIndices.length,
    },
  };
}
