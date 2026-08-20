export const FILE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const FILE_PREVIEW_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FILE_LIST_MAX_ENTRIES = 500;
export const FILE_SEARCH_MAX_RESULTS = 500;

export type FileEntryKind = "directory" | "file" | "symlink" | "other";

export interface FileWorkspaceRequest {
  projectId: string;
  root: string;
  path?: string;
}

export interface FileSearchRequest {
  projectId: string;
  root: string;
  query: string;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
}

export interface FileListResult {
  projectId: string;
  root: string;
  path: string;
  parent?: string;
  entries: FileEntry[];
  truncated: boolean;
}

export interface FileSearchResult {
  projectId: string;
  root: string;
  query: string;
  entries: FileEntry[];
  truncated: boolean;
}

interface FilePreviewBase {
  projectId: string;
  root: string;
  path: string;
  name: string;
  size: number;
}

export interface TextFilePreview extends FilePreviewBase {
  kind: "text";
  content: string;
  language: string;
  version: string;
  truncated: boolean;
}

export interface ImageFilePreview extends FilePreviewBase {
  kind: "image";
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";
  dataUrl: string;
  version: string;
}

export interface UnsupportedFilePreview extends FilePreviewBase {
  kind: "unsupported";
  reason: "binary" | "too-large";
}

export type FilePreviewResult = TextFilePreview | ImageFilePreview | UnsupportedFilePreview;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0) || value.includes("\0")) {
    throw new TypeError(`${label} must be a valid string`);
  }
  return value;
}

export function parseFileWorkspaceRequest(value: unknown): FileWorkspaceRequest {
  const candidate = record(value, "file workspace request");
  return {
    projectId: text(candidate.projectId, "projectId"),
    root: text(candidate.root, "root"),
    path: candidate.path === undefined ? undefined : text(candidate.path, "path", true),
  };
}

export function parseFileSearchRequest(value: unknown): FileSearchRequest {
  const candidate = record(value, "file search request");
  const query = text(candidate.query, "query", true).trim();
  if (query.length > 100) throw new TypeError("query is too long");
  return {
    projectId: text(candidate.projectId, "projectId"),
    root: text(candidate.root, "root"),
    query,
  };
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function previewBase(value: Record<string, unknown>): FilePreviewBase {
  return {
    projectId: text(value.projectId, "preview projectId"),
    root: text(value.root, "preview root"),
    path: text(value.path, "preview path"),
    name: text(value.name, "preview name"),
    size: nonNegativeInteger(value.size, "preview size"),
  };
}

function parseFileEntries(value: unknown): FileEntry[] {
  if (!Array.isArray(value)) throw new TypeError("file entries must be an array");
  return value.map((entryValue) => {
    const entry = record(entryValue, "file entry");
    const kind = entry.kind;
    if (kind !== "directory" && kind !== "file" && kind !== "symlink" && kind !== "other") throw new TypeError("file entry kind is invalid");
    return { name: text(entry.name, "file entry name"), path: text(entry.path, "file entry path", true), kind };
  });
}

export function parseFileListResult(value: unknown): FileListResult {
  const candidate = record(value, "file list result");
  return {
    projectId: text(candidate.projectId, "list projectId"),
    root: text(candidate.root, "list root"),
    path: text(candidate.path, "list path", true),
    parent: candidate.parent === undefined ? undefined : text(candidate.parent, "list parent", true),
    entries: parseFileEntries(candidate.entries),
    truncated: candidate.truncated === true,
  };
}

export function parseFileSearchResult(value: unknown): FileSearchResult {
  const candidate = record(value, "file search result");
  return {
    projectId: text(candidate.projectId, "search projectId"),
    root: text(candidate.root, "search root"),
    query: text(candidate.query, "search query", true),
    entries: parseFileEntries(candidate.entries),
    truncated: candidate.truncated === true,
  };
}

export function parseFilePreviewResult(value: unknown): FilePreviewResult {
  const candidate = record(value, "file preview result");
  const base = previewBase(candidate);
  if (candidate.kind === "text") {
    return {
      ...base,
      kind: "text",
      content: text(candidate.content, "preview content", true),
      language: text(candidate.language, "preview language", true),
      version: text(candidate.version, "preview version"),
      truncated: candidate.truncated === true,
    };
  }
  if (candidate.kind === "image") {
    if (!candidate.dataUrl || typeof candidate.dataUrl !== "string") throw new TypeError("preview image data is invalid");
    const mimeType = candidate.mimeType;
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/gif" && mimeType !== "image/webp" && mimeType !== "image/avif") throw new TypeError("preview image type is invalid");
    return { ...base, kind: "image", mimeType, dataUrl: candidate.dataUrl, version: text(candidate.version, "preview version") };
  }
  if (candidate.kind === "unsupported") {
    if (candidate.reason !== "binary" && candidate.reason !== "too-large") throw new TypeError("preview unsupported reason is invalid");
    return { ...base, kind: "unsupported", reason: candidate.reason };
  }
  throw new TypeError("file preview kind is invalid");
}
