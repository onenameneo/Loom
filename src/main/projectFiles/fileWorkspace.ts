import { promises as fs } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { Store } from "../store/store";
import {
  FILE_LIST_MAX_ENTRIES,
  FILE_PREVIEW_MAX_BYTES,
  FILE_PREVIEW_MAX_IMAGE_BYTES,
  FILE_SEARCH_MAX_RESULTS,
  type FileEntry,
  type FileListResult,
  type FilePreviewResult,
  type FileSearchResult,
  type FileSearchRequest,
  type FileWorkspaceRequest,
} from "../../common/filePreview";
import {
  fileVersion,
  relativeProjectPath,
  resolveExistingFile,
  resolveInside,
  selectProjectRoot,
} from "../agent/tools/projectFiles/access";

const imageMimeTypes: Record<string, Extract<FilePreviewResult, { kind: "image" }>['mimeType']> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

const languageByExtension: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".sh": "shell",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".sql": "sql",
};

const searchExcludedDirectories = new Set([".git", "node_modules", "out", "dist", "coverage"]);

function projectFor(store: Store, projectId: string) {
  const project = store.listProjects().find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("Project not found.");
  return project;
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.1;
}

function languageFor(path: string): string {
  return languageByExtension[extname(path).toLowerCase()] ?? "plaintext";
}

function sortEntries(left: FileEntry, right: FileEntry): number {
  if (left.kind === "directory" && right.kind !== "directory") return -1;
  if (left.kind !== "directory" && right.kind === "directory") return 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

async function readPrefix(path: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export class ProjectFileWorkspace {
  constructor(private readonly store: Store) {}

  private async rootFor(request: FileWorkspaceRequest) {
    const project = projectFor(this.store, request.projectId);
    const root = await selectProjectRoot(project.sourceRoots, request.root);
    return { project, root };
  }

  async list(request: FileWorkspaceRequest): Promise<FileListResult> {
    const { root } = await this.rootFor(request);
    const directory = await resolveInside(root, request.path || ".");
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error("Path is not a directory.");
    const source = await fs.readdir(directory, { withFileTypes: true });
    const entries: FileEntry[] = [];
    for (const entry of source) {
      const candidate = join(directory, entry.name);
      try {
        await resolveInside(root, relativeProjectPath(root, candidate));
      } catch {
        continue;
      }
      entries.push({
        name: entry.name,
        path: relativeProjectPath(root, candidate),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
      });
    }
    entries.sort(sortEntries);
    const bounded = entries.slice(0, FILE_LIST_MAX_ENTRIES);
    const relative = relativeProjectPath(root, directory);
    const parent = relative === "." ? undefined : relativeProjectPath(root, dirname(directory));
    return { projectId: request.projectId, root: request.root, path: relative, parent, entries: bounded, truncated: entries.length > bounded.length };
  }

  async search(request: FileSearchRequest): Promise<FileSearchResult> {
    const { root } = await this.rootFor(request);
    const query = request.query.trim().toLocaleLowerCase();
    if (query.length === 0) return { projectId: request.projectId, root: request.root, query: request.query, entries: [], truncated: false };
    const matches: FileEntry[] = [];
    const visit = async (directory: string): Promise<void> => {
      if (matches.length >= FILE_SEARCH_MAX_RESULTS) return;
      let source;
      try {
        source = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of source) {
        if (matches.length >= FILE_SEARCH_MAX_RESULTS) return;
        const candidate = join(directory, entry.name);
        let relative: string;
        try {
          await resolveInside(root, relativeProjectPath(root, candidate));
          relative = relativeProjectPath(root, candidate);
        } catch {
          continue;
        }
        if (entry.name.toLocaleLowerCase().includes(query)) {
          matches.push({ name: entry.name, path: relative, kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other" });
        }
        if (entry.isDirectory() && !searchExcludedDirectories.has(entry.name)) await visit(candidate);
      }
    };
    await visit(root.realPath);
    matches.sort(sortEntries);
    return { projectId: request.projectId, root: request.root, query: request.query, entries: matches, truncated: matches.length >= FILE_SEARCH_MAX_RESULTS };
  }

  async preview(request: FileWorkspaceRequest): Promise<FilePreviewResult> {
    const { root } = await this.rootFor(request);
    const target = await resolveExistingFile(root, request.path || ".");
    const stat = await fs.stat(target.absolutePath);
    const name = basename(target.absolutePath);
    const base = { projectId: request.projectId, root: request.root, path: target.relativePath, name, size: stat.size };
    const version = fileVersion(stat);
    const mimeType = imageMimeTypes[extname(target.absolutePath).toLowerCase()];
    if (mimeType) {
      if (stat.size > FILE_PREVIEW_MAX_IMAGE_BYTES) return { ...base, kind: "unsupported", reason: "too-large" };
      const content = await fs.readFile(target.absolutePath);
      return { ...base, kind: "image", mimeType, dataUrl: `data:${mimeType};base64,${content.toString("base64")}`, version };
    }
    const content = await readPrefix(target.absolutePath, FILE_PREVIEW_MAX_BYTES);
    if (isBinary(content)) return { ...base, kind: "unsupported", reason: "binary" };
    const truncated = content.length > FILE_PREVIEW_MAX_BYTES;
    const bounded = content.subarray(0, FILE_PREVIEW_MAX_BYTES);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bounded);
    } catch {
      return { ...base, kind: "unsupported", reason: "binary" };
    }
    return { ...base, kind: "text", content: text, language: languageFor(target.relativePath), version, truncated };
  }

  async absoluteFilePath(request: FileWorkspaceRequest): Promise<string> {
    const { root } = await this.rootFor(request);
    const target = await resolveExistingFile(root, request.path || ".");
    return target.absolutePath;
  }
}
