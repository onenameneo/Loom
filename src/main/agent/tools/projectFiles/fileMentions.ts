import { promises as fs } from "node:fs";
import { basename } from "node:path";
import type {
  FileCandidate,
  FileMentionError,
  FileMentionRef,
  FileMentionResolution,
  ResolvedFileMention,
} from "../../../../common/fileMentions";
import { isFileMentionPath, normalizeFileMentionPath } from "../../../../common/fileMentions";
import { abortIfNeeded, resolveExistingFile, selectProjectRoot } from "./access";
import { walkProjectFiles } from "./walker";

export const MAX_FILE_MENTION_CANDIDATES = 100;
export const MAX_FILE_MENTION_BYTES = 50 * 1024;
export const MAX_FILE_MENTION_LINES = 2_000;
export const MAX_FILE_MENTION_COUNT = 20;
export const MAX_FILE_MENTION_TOTAL_BYTES = 160 * 1024;

function rootName(configuredPath: string): string {
  return basename(configuredPath) || configuredPath;
}

function errorFor(root: string, path: string, code: FileMentionError["code"], message: string): FileMentionError {
  return { root, path, code, message };
}

async function readMentionText(path: string): Promise<{ content?: string; error?: FileMentionError["code"] }> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) return { error: "unreadable" };
  if (stat.size > MAX_FILE_MENTION_BYTES) return { error: "too-large" };
  const buffer = await fs.readFile(path);
  if (buffer.includes(0)) return { error: "binary" };
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { error: "binary" };
  }
  if (content.split(/\r?\n/).length > MAX_FILE_MENTION_LINES) return { error: "too-large" };
  return { content };
}

export async function findProjectFileCandidates(
  sourceRoots: string[],
  query = "",
  limit = MAX_FILE_MENTION_CANDIDATES,
  signal?: AbortSignal,
): Promise<FileCandidate[]> {
  const normalizedQuery = normalizeFileMentionPath(query.trim()).toLocaleLowerCase();
  const candidates: FileCandidate[] = [];
  const boundedLimit = Math.max(1, Math.min(MAX_FILE_MENTION_CANDIDATES, Math.floor(limit)));

  for (let index = 0; index < sourceRoots.length && candidates.length < boundedLimit; index += 1) {
    abortIfNeeded(signal);
    const rootId = `project:${index}`;
    const root = await selectProjectRoot(sourceRoots, rootId);
    const walked = await walkProjectFiles(root, undefined, signal, {
      skipUnsafeSymlinks: true,
      skipHidden: true,
      respectGitignore: true,
    });
    for (const file of walked.files) {
      abortIfNeeded(signal);
      const path = normalizeFileMentionPath(file.relativePath);
      if (normalizedQuery && !path.toLocaleLowerCase().includes(normalizedQuery)) continue;
      candidates.push({ root: rootId, rootName: rootName(root.configuredPath), path, kind: "file" });
      if (candidates.length >= boundedLimit) break;
    }
  }
  return candidates;
}

export async function resolveProjectFileMentions(
  sourceRoots: string[],
  mentions: FileMentionRef[],
  signal?: AbortSignal,
): Promise<FileMentionResolution> {
  const files: ResolvedFileMention[] = [];
  const errors: FileMentionError[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const [index, mention] of mentions.entries()) {
    abortIfNeeded(signal);
    const rootId = mention.root.trim();
    const path = normalizeFileMentionPath(mention.path.trim());
    if (index >= MAX_FILE_MENTION_COUNT) {
      errors.push(errorFor(rootId, path, "too-large", `一次最多引用 ${MAX_FILE_MENTION_COUNT} 个文件。`));
      continue;
    }
    if (!isFileMentionPath(path)) {
      errors.push(errorFor(rootId, path, "outside-root", "文件路径必须位于当前项目源目录内。"));
      continue;
    }
    const key = `${rootId}\u0000${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const root = await selectProjectRoot(sourceRoots, rootId);
      const target = await resolveExistingFile(root, path);
      const read = await readMentionText(target.absolutePath);
      if (!read.content) {
        const messages: Record<"binary" | "too-large" | "unreadable", string> = {
          binary: "文件不是可安全注入的 UTF-8 文本文件。",
          "too-large": `文件超过 ${MAX_FILE_MENTION_BYTES / 1024}KB 或 ${MAX_FILE_MENTION_LINES} 行限制。`,
          unreadable: "文件无法读取。",
        };
        const errorCode = (read.error ?? "unreadable") as "binary" | "too-large" | "unreadable";
        errors.push(errorFor(rootId, path, errorCode, messages[errorCode]));
        continue;
      }
      const bytes = Buffer.byteLength(read.content, "utf-8");
      if (totalBytes + bytes > MAX_FILE_MENTION_TOTAL_BYTES) {
        errors.push(errorFor(rootId, path, "too-large", `文件引用总上下文超过 ${MAX_FILE_MENTION_TOTAL_BYTES / 1024}KB 限制。`));
        continue;
      }
      totalBytes += bytes;
      files.push({ root: rootId, path: target.relativePath, content: read.content });
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件无法读取。";
      const code = /outside|root/i.test(message)
        ? "outside-root"
        : (error as NodeJS.ErrnoException)?.code === "ENOENT" || (error as NodeJS.ErrnoException)?.code === "ENOTDIR"
          ? "not-found"
          : "unreadable";
      errors.push(errorFor(rootId, path, code, message));
    }
  }
  return {
    files,
    errors,
    metadata: { requested: mentions.length, resolved: files.length, rejected: errors.length, totalBytes },
  };
}
