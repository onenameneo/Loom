export type FileArtifactKind = "document" | "image" | "archive" | "text" | "other";
export type FileArtifactOperation = "created" | "updated" | "exported";
export type FileArtifactStatus = "available" | "stale" | "unavailable";

export interface FileArtifactProjectIdentity {
  projectId: string;
  root: string;
  path: string;
}

export interface FileArtifactRef {
  id: string;
  name: string;
  displayPath: string;
  kind: FileArtifactKind;
  operation: FileArtifactOperation;
  status: FileArtifactStatus;
  project?: FileArtifactProjectIdentity;
  version?: string;
  error?: string;
}

export interface FileArtifactRecord extends FileArtifactRef {
  absolutePath: string;
}

export type FileArtifactAction = "open" | "reveal" | "preview";

export interface FileArtifactActionRequest {
  id: string;
  action: FileArtifactAction;
}

export interface FileArtifactActionResult {
  ok: boolean;
  error?: "not-found" | "stale" | "unavailable" | "unsupported" | "open-failed";
  message?: string;
  preview?: { projectId: string; root: string; path: string };
}

export const FILE_ARTIFACT_LINK_PREFIX = "loom-file://artifact/";
const artifactIdPattern = /^artifact_[A-Za-z0-9_-]{8,128}$/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || value.includes("\0") || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${label} must be a valid string`);
  }
  return value;
}

function artifactId(value: unknown): string {
  const id = stringValue(value, "artifact id");
  if (!artifactIdPattern.test(id)) throw new TypeError("artifact id is invalid");
  return id;
}

function projectIdentity(value: unknown): FileArtifactProjectIdentity | undefined {
  if (value === undefined) return undefined;
  const project = asRecord(value, "artifact project");
  return {
    projectId: stringValue(project.projectId, "artifact projectId"),
    root: stringValue(project.root, "artifact root"),
    path: stringValue(project.path, "artifact path", true),
  };
}

export function parseFileArtifactRef(value: unknown): FileArtifactRef {
  const candidate = asRecord(value, "file artifact");
  const kind = candidate.kind;
  const operation = candidate.operation;
  const status = candidate.status ?? "available";
  if (kind !== "document" && kind !== "image" && kind !== "archive" && kind !== "text" && kind !== "other") throw new TypeError("artifact kind is invalid");
  if (operation !== "created" && operation !== "updated" && operation !== "exported") throw new TypeError("artifact operation is invalid");
  if (status !== "available" && status !== "stale" && status !== "unavailable") throw new TypeError("artifact status is invalid");
  return {
    id: artifactId(candidate.id),
    name: stringValue(candidate.name, "artifact name"),
    displayPath: stringValue(candidate.displayPath, "artifact displayPath"),
    kind,
    operation,
    status,
    project: projectIdentity(candidate.project),
    version: candidate.version === undefined ? undefined : stringValue(candidate.version, "artifact version", true),
    error: candidate.error === undefined ? undefined : stringValue(candidate.error, "artifact error", true),
  };
}

export function parseFileArtifactRecords(value: unknown): FileArtifactRef[] {
  if (!Array.isArray(value)) throw new TypeError("file artifact records must be an array");
  return value.map((item) => {
    const record = asRecord(item, "file artifact record");
    stringValue(record.absolutePath, "artifact absolutePath");
    return parseFileArtifactRef(record);
  });
}

export function parseArtifactActionRequest(value: unknown): FileArtifactActionRequest {
  const candidate = asRecord(value, "artifact action request");
  if (Object.prototype.hasOwnProperty.call(candidate, "path") || Object.prototype.hasOwnProperty.call(candidate, "absolutePath")) {
    throw new TypeError("artifact action requests must use an opaque id");
  }
  const action = candidate.action;
  if (action !== "open" && action !== "reveal" && action !== "preview") throw new TypeError("artifact action is invalid");
  return { id: artifactId(candidate.id), action };
}

export function artifactLink(ref: Pick<FileArtifactRef, "id">): string {
  return `${FILE_ARTIFACT_LINK_PREFIX}${encodeURIComponent(ref.id)}`;
}

export function artifactIdFromLink(href: unknown): string | undefined {
  if (typeof href !== "string" || !href.startsWith(FILE_ARTIFACT_LINK_PREFIX)) return undefined;
  const encoded = href.slice(FILE_ARTIFACT_LINK_PREFIX.length);
  try {
    const id = decodeURIComponent(encoded);
    return artifactIdPattern.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
