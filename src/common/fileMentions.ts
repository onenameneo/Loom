export interface FileMentionRef {
  root: string;
  path: string;
}

export interface FileCandidate {
  root: string;
  rootName: string;
  path: string;
  kind: "file";
}

export type FileMentionErrorCode = "not-found" | "outside-root" | "binary" | "too-large" | "unreadable";

export interface FileMentionError {
  root: string;
  path: string;
  code: FileMentionErrorCode;
  message: string;
}

export interface ResolvedFileMention {
  root: string;
  path: string;
  content: string;
}

export interface FileMentionResolution {
  files: ResolvedFileMention[];
  errors: FileMentionError[];
  metadata: {
    requested: number;
    resolved: number;
    rejected: number;
    totalBytes: number;
  };
}

export function normalizeFileMentionPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isFileMentionPath(path: string): boolean {
  const normalized = normalizeFileMentionPath(path);
  const segments = normalized.split("/");
  return Boolean(normalized) && normalized !== "." && !normalized.startsWith("/") && !segments.includes("..") && !segments.includes("");
}
