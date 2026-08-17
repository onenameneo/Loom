export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_STATUSES = ["active", "candidate", "rejected", "archived", "stale", "conflicted"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export type MemoryScope =
  | { kind: "user" }
  | { kind: "project"; projectId: string };

export type MemoryTrigger = "explicit" | "manual" | "extracted" | "autodream";

export interface MemorySource {
  trigger: MemoryTrigger;
  sessionId?: string;
  nodeId?: string;
  excerpt?: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  status: MemoryStatus;
  confidence: number;
  description: string;
  content: string;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt?: number;
  supersedes?: string[];
  dedupeKey?: string;
  archivedReason?: string;
  path?: string;
}

export interface MemoryIssue {
  path: string;
  message: string;
}

export interface MemoryScan {
  records: MemoryRecord[];
  issues: MemoryIssue[];
}

export interface MemoryWriteInput {
  id?: string;
  type: MemoryType;
  scope: MemoryScope;
  description: string;
  content: string;
  confidence?: number;
  source?: Partial<MemorySource> & Pick<MemorySource, "trigger">;
  lastConfirmedAt?: number;
  supersedes?: string[];
  dedupeKey?: string;
}

export interface MemoryCandidateInput extends MemoryWriteInput {
  source: Partial<MemorySource> & Pick<MemorySource, "trigger">;
}

export interface MemoryStats {
  active: number;
  candidates: number;
  archived: number;
  stale: number;
  conflicted: number;
  issues: number;
}

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === "string" && (MEMORY_STATUSES as readonly string[]).includes(value);
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Record<string, unknown>;
  if (scope.kind === "user") return true;
  return scope.kind === "project" && typeof scope.projectId === "string" && scope.projectId.trim().length > 0;
}

export function normalizeConfidence(value: unknown): number {
  const confidence = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.max(0, Math.min(1, confidence));
}
