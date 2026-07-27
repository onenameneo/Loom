import { constants, promises as fs } from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { randomUUID } from "crypto";

export const DEFAULT_MAX_ENTRIES = 200;
export const MAX_ENTRIES = 1000;
export const DEFAULT_MAX_LINES = 400;
export const MAX_LINES = 2000;
export const MAX_OUTPUT_CHARS = 32_000;

export interface ProjectRoot {
  configuredPath: string;
  realPath: string;
}

export interface ProjectFileTarget {
  root: ProjectRoot;
  absolutePath: string;
  relativePath: string;
  canonicalKey: string;
  exists: boolean;
}

export function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Operation aborted");
}

export function boundedInteger(value: unknown, fallback: number, max: number, minimum = 1): number {
  const candidate = Number(value ?? fallback);
  if (!Number.isFinite(candidate)) return fallback;
  return Math.max(minimum, Math.min(max, Math.floor(candidate)));
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`${sep}..${sep}`));
}

export async function selectProjectRoot(sourceFolders: string[], requested?: string): Promise<ProjectRoot> {
  const configured = [...new Set(sourceFolders.map((folder) => resolve(folder)).filter(Boolean))];
  if (configured.length === 0) throw new Error("No source folders are configured for this Project.");
  const configuredPath = requested ? resolve(requested) : configured[0];
  if (!configured.includes(configuredPath)) throw new Error("Requested root is not one of this Project's source folders.");
  return { configuredPath, realPath: await fs.realpath(configuredPath) };
}

export async function resolveInside(root: ProjectRoot, inputPath = "."): Promise<string> {
  const lexical = resolve(root.realPath, inputPath);
  if (!isInside(root.realPath, lexical)) throw new Error("Path is outside this Project's source folders.");
  const realPath = await fs.realpath(lexical);
  if (!isInside(root.realPath, realPath)) throw new Error("Path is outside this Project's source folders.");
  return realPath;
}

export async function resolveExistingFile(root: ProjectRoot, inputPath: string): Promise<ProjectFileTarget> {
  const absolutePath = await resolveInside(root, inputPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error("Path is not a file.");
  return {
    root,
    absolutePath,
    relativePath: relativeProjectPath(root, absolutePath),
    canonicalKey: `${root.realPath}\u0000${absolutePath}`,
    exists: true,
  };
}

export async function resolveMutationTarget(root: ProjectRoot, inputPath: string): Promise<ProjectFileTarget> {
  const lexical = resolve(root.realPath, inputPath);
  if (!isInside(root.realPath, lexical)) throw new Error("Path is outside this Project's source folders.");
  const parent = dirname(lexical);
  const parentRealPath = await fs.realpath(parent);
  if (!isInside(root.realPath, parentRealPath)) throw new Error("Path is outside this Project's source folders.");

  let exists = false;
  let absolutePath = join(parentRealPath, basename(lexical));
  try {
    const lstat = await fs.lstat(absolutePath);
    exists = true;
    if (lstat.isSymbolicLink()) throw new Error("Mutation target must not be a symbolic link.");
    const realPath = await fs.realpath(absolutePath);
    if (!isInside(root.realPath, realPath)) throw new Error("Path is outside this Project's source folders.");
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw new Error("Mutation target must be a regular file.");
    absolutePath = realPath;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return {
    root,
    absolutePath,
    relativePath: relativeProjectPath(root, absolutePath),
    canonicalKey: `${root.realPath}\u0000${absolutePath}`,
    exists,
  };
}

export function relativeProjectPath(root: ProjectRoot, target: string): string {
  return relative(root.realPath, target).split(sep).join("/") || ".";
}

export function isWithinRoot(root: ProjectRoot, target: string): boolean {
  return isInside(root.realPath, target);
}

export function canonicalApprovalTarget(target: Pick<ProjectFileTarget, "root" | "relativePath">): string {
  return `${target.root.realPath}:${target.relativePath}`;
}

export function boundedPreview(value: string, limit = 160): { length: number; preview: string; truncated: boolean } {
  const limited = value.length > limit ? value.slice(0, limit) : value;
  return { length: value.length, preview: limited, truncated: limited.length < value.length };
}

export function boundedMutationDiff(before: string, after: string, path: string, maxChars = MAX_OUTPUT_CHARS): string {
  return boundedMutationDiffDetails(before, after, path, maxChars).text;
}

export function boundedMutationDiffDetails(
  before: string,
  after: string,
  path: string,
  maxChars = MAX_OUTPUT_CHARS,
): { text: string; truncated: boolean } {
  const beforeLines = before.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [`--- ${path}`, `+++ ${path}`];
  let truncated = false;
  const limit = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < limit; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined && !appendBounded(lines, `- ${oldLine}`, maxChars)) {
      truncated = true;
      break;
    }
    if (newLine !== undefined && !appendBounded(lines, `+ ${newLine}`, maxChars)) {
      truncated = true;
      break;
    }
  }
  if (lines.length === 2) appendBounded(lines, "(no textual changes)", maxChars);
  return { text: lines.join("\n"), truncated };
}

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

export async function withFileMutationQueue<T>(canonicalKey: string, operation: () => Promise<T>): Promise<T> {
  const registration = registrationQueue.then(() => {
    const currentQueue = fileMutationQueues.get(canonicalKey) ?? Promise.resolve();
    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(canonicalKey, chainedQueue);
    return { currentQueue, chainedQueue, releaseNext };
  });
  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );

  const { currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await operation();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(canonicalKey) === chainedQueue) fileMutationQueues.delete(canonicalKey);
  }
}

export async function atomicReplaceUtf8(targetPath: string, content: string, signal?: AbortSignal): Promise<void> {
  abortIfNeeded(signal);
  const directory = dirname(targetPath);
  const tempPath = join(directory, `.loom-${basename(targetPath)}-${randomUUID()}.tmp`);
  const handle = await fs.open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o666);
  let closed = false;
  try {
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    closed = true;
    await handle.close();
    abortIfNeeded(signal);
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    if (!closed) await handle.close().catch(() => undefined);
    await fs.unlink(tempPath).catch(() => undefined);
    throw err;
  }
}

export function appendBounded(lines: string[], value: string, maxChars = MAX_OUTPUT_CHARS): boolean {
  const nextLength = lines.reduce((length, line) => length + line.length + 1, 0) + value.length + (lines.length ? 1 : 0);
  if (nextLength > maxChars) return false;
  lines.push(value);
  return true;
}
