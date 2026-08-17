import { createHash } from "node:crypto";
import type { MemoryRecord, MemoryScope, MemorySource } from "./types";
import { isMemoryScope, isMemoryStatus, isMemoryType, normalizeConfidence } from "./types";

const FRONTMATTER_DELIMITER = "---";

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return trimmed;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return quote(String(value ?? ""));
}

export function parseFrontmatter(source: string): { metadata: Record<string, unknown>; body: string } {
  const normalized = source.replace(/^\uFEFF/, "");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`) && !normalized.startsWith(`${FRONTMATTER_DELIMITER}\r\n`)) {
    throw new Error("Markdown memory is missing YAML frontmatter.");
  }
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Markdown memory frontmatter is not closed.");
  const metadata: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid frontmatter line: ${line}`);
    metadata[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }
  return { metadata, body: match[2].trim() };
}

function requiredString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Memory frontmatter field '${key}' is required.`);
  return value.trim();
}

function optionalString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(metadata: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const value = metadata[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Memory frontmatter field '${key}' must be a number.`);
  return value;
}

function listField(metadata: Record<string, unknown>, key: string): string[] | undefined {
  const value = metadata[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Memory frontmatter field '${key}' must be a string array.`);
  }
  return value;
}

export function recordFromMarkdown(source: string, path?: string): MemoryRecord {
  const { metadata, body } = parseFrontmatter(source);
  const type = metadata.type;
  const status = metadata.status;
  if (!isMemoryType(type)) throw new Error("Memory frontmatter has an unsupported type.");
  if (!isMemoryStatus(status)) throw new Error("Memory frontmatter has an unsupported status.");
  const scopeKind = metadata.scope;
  if (scopeKind !== "user" && scopeKind !== "project") throw new Error("Memory frontmatter has an invalid scope.");
  const scope: MemoryScope = scopeKind === "project"
    ? { kind: "project", projectId: requiredString(metadata, "projectId") }
    : { kind: "user" };
  if (!isMemoryScope(scope)) throw new Error("Memory frontmatter has an invalid scope.");
  const sourceTrigger = optionalString(metadata, "sourceTrigger");
  if (!sourceTrigger || !["explicit", "manual", "extracted", "autodream"].includes(sourceTrigger)) {
    throw new Error("Memory frontmatter field 'sourceTrigger' is required.");
  }
  const createdAt = numberField(metadata, "createdAt");
  const updatedAt = numberField(metadata, "updatedAt");
  if (createdAt === undefined || updatedAt === undefined) throw new Error("Memory timestamps are required.");
  return {
    id: requiredString(metadata, "id"),
    type,
    scope,
    status,
    confidence: normalizeConfidence(metadata.confidence),
    description: requiredString(metadata, "description"),
    content: body,
    source: {
      trigger: sourceTrigger as MemorySource["trigger"],
      sessionId: optionalString(metadata, "sourceSessionId"),
      nodeId: optionalString(metadata, "sourceNodeId"),
      excerpt: optionalString(metadata, "sourceExcerpt"),
    },
    createdAt,
    updatedAt,
    lastConfirmedAt: numberField(metadata, "lastConfirmedAt"),
    supersedes: listField(metadata, "supersedes"),
    dedupeKey: optionalString(metadata, "dedupeKey"),
    archivedReason: optionalString(metadata, "archivedReason"),
    path,
  };
}

export function markdownForRecord(record: MemoryRecord): string {
  const lines = [
    FRONTMATTER_DELIMITER,
    `id: ${scalar(record.id)}`,
    `type: ${scalar(record.type)}`,
    `scope: ${scalar(record.scope.kind)}`,
    ...(record.scope.kind === "project" ? [`projectId: ${scalar(record.scope.projectId)}`] : []),
    `status: ${scalar(record.status)}`,
    `confidence: ${scalar(Number(record.confidence.toFixed(4)))}`,
    `description: ${scalar(record.description)}`,
    `sourceTrigger: ${scalar(record.source.trigger)}`,
    ...(record.source.sessionId ? [`sourceSessionId: ${scalar(record.source.sessionId)}`] : []),
    ...(record.source.nodeId ? [`sourceNodeId: ${scalar(record.source.nodeId)}`] : []),
    ...(record.source.excerpt ? [`sourceExcerpt: ${scalar(record.source.excerpt)}`] : []),
    `createdAt: ${scalar(record.createdAt)}`,
    `updatedAt: ${scalar(record.updatedAt)}`,
    ...(record.lastConfirmedAt !== undefined ? [`lastConfirmedAt: ${scalar(record.lastConfirmedAt)}`] : []),
    ...(record.supersedes?.length ? [`supersedes: ${scalar(record.supersedes)}`] : []),
    ...(record.dedupeKey ? [`dedupeKey: ${scalar(record.dedupeKey)}`] : []),
    ...(record.archivedReason ? [`archivedReason: ${scalar(record.archivedReason)}`] : []),
    FRONTMATTER_DELIMITER,
    "",
    record.content.trim(),
    "",
  ];
  return lines.join("\n");
}

export function stableMemoryId(type: string, scope: MemoryScope, content: string): string {
  const key = `${type}:${scope.kind}:${scope.kind === "project" ? scope.projectId : ""}:${content.trim().toLowerCase()}`;
  return `mem_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function normalizeDedupeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
