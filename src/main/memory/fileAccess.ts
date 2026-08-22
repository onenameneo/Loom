import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { recordFromMarkdown } from "./markdown";
import { MemoryStore } from "./storage";
import type { MemoryRecord, MemoryScope } from "./types";

export type MemoryRootId = "memory:user" | "memory:project" | "memory:candidates" | "memory:archive";

interface MemoryWriteInput {
  root: MemoryRootId;
  path: string;
  content: string;
  overwrite?: boolean;
  expectedVersion?: string;
}

interface MemoryEditInput {
  root: MemoryRootId;
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  expectedVersion?: string;
}

export interface MemoryRootDescriptor {
  id: MemoryRootId;
  kind: "user" | "project" | "candidates" | "archive";
  path: string;
  displayPath: string;
  readOnly: boolean;
}

export interface FileRootDescriptor {
  id: string;
  kind: "project" | "memory";
  path: string;
  displayPath: string;
}

export class FileRootRegistry {
  readonly roots: FileRootDescriptor[];

  constructor(options: { sourceRoots: string[]; memory?: MemoryFileAccess }) {
    this.roots = [
      ...options.sourceRoots.map((path, index) => ({
        id: `project:${index}`,
        kind: "project" as const,
        path: resolve(path),
        displayPath: `project:${index}`,
      })),
      ...(options.memory?.descriptors() ?? []).map((root) => ({
        id: root.id,
        kind: "memory" as const,
        path: root.path,
        displayPath: root.displayPath,
      })),
    ];
  }

  get(id: string | undefined): FileRootDescriptor | undefined {
    if (!id) return this.roots.find((root) => root.id === "project:0");
    return this.roots.find((root) => root.id === id);
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`${sep}..${sep}`));
}

function fileVersion(stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function boundedText(content: string, offset = 1, limit = 400): { text: string; totalLines: number; returnedLines: number; truncated: boolean; nextOffset?: number } {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const start = Math.max(1, Math.floor(offset));
  const count = Math.max(1, Math.min(2000, Math.floor(limit)));
  const selected = lines.slice(start - 1, start - 1 + count);
  const truncated = start - 1 + selected.length < lines.length;
  return {
    text: selected.map((line, index) => `${start + index} | ${line}`).join("\n"),
    totalLines: lines.length,
    returnedLines: selected.length,
    truncated,
    ...(truncated ? { nextOffset: start + selected.length } : {}),
  };
}

export class MemoryFileAccess {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly store: MemoryStore,
    private readonly projectId?: string,
    private readonly onPrimaryWrite?: (record: MemoryRecord) => void,
    private readonly context?: { sessionId: string; nodeId: string },
  ) {}

  descriptors(): MemoryRootDescriptor[] {
    const root = this.store.rootDir;
    const projectPath = this.projectId ? join(root, "projects", this.projectId) : undefined;
    return [
      { id: "memory:user", kind: "user", path: root, displayPath: "~/.loom/memory (user scope)", readOnly: false },
      ...(projectPath
        ? [{ id: "memory:project" as const, kind: "project" as const, path: projectPath, displayPath: `~/.loom/memory/projects/${this.projectId}`, readOnly: false }]
        : []),
      { id: "memory:candidates", kind: "candidates", path: join(root, "candidates"), displayPath: "~/.loom/memory/candidates", readOnly: false },
      { id: "memory:archive", kind: "archive", path: join(root, "archive"), displayPath: "~/.loom/memory/archive", readOnly: true },
    ];
  }

  private descriptor(rootId: MemoryRootId): MemoryRootDescriptor {
    const descriptor = this.descriptors().find((item) => item.id === rootId);
    if (!descriptor) throw new Error(rootId === "memory:project" ? "A current Project is required for project memory." : `Unknown memory root: ${rootId}`);
    return descriptor;
  }

  private async safeTarget(rootId: MemoryRootId, path: string, existing: boolean): Promise<{ descriptor: MemoryRootDescriptor; target: string; relativePath: string }> {
    await this.store.initialize();
    const descriptor = this.descriptor(rootId);
    const target = resolve(descriptor.path, path || ".");
    if (!isInside(resolve(descriptor.path), target)) throw new Error("Memory path escapes the selected root.");
    // A project/type directory may not exist until the first memory is written.
    // Resolve the nearest existing ancestor so validation does not create arbitrary
    // directories before the Markdown schema has been checked.
    await fs.mkdir(descriptor.path, { recursive: true });
    const realRoot = await fs.realpath(descriptor.path);
    let ancestor = existing ? target : dirname(target);
    while (ancestor !== descriptor.path) {
      try {
        await fs.access(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ancestor = dirname(ancestor);
      }
    }
    const realParent = await fs.realpath(ancestor);
    if (!isInside(realRoot, realParent)) throw new Error("Memory path escapes through a symlink.");
    if (existing) {
      const realTarget = await fs.realpath(target);
      if (!isInside(realRoot, realTarget)) throw new Error("Memory path escapes through a symlink.");
    }
    return { descriptor, target, relativePath: relative(descriptor.path, target) || "." };
  }

  async resolveTarget(rootId: MemoryRootId, path: string): Promise<string> {
    return (await this.safeTarget(rootId, path, false)).target;
  }

  async read(input: { root: MemoryRootId; path: string; offset?: number; limit?: number }): Promise<{
    text: string;
    path: string;
    version: string;
    totalLines: number;
    returnedLines: number;
    truncation: { truncated: boolean; nextOffset?: number };
  }> {
    const resolved = await this.safeTarget(input.root, input.path, true);
    const stat = await fs.stat(resolved.target);
    if (!stat.isFile()) throw new Error("Memory target is not a file.");
    const content = await fs.readFile(resolved.target, "utf8");
    const window = boundedText(content, input.offset, input.limit);
    return {
      ...window,
      path: resolved.relativePath,
      version: fileVersion(stat),
      truncation: { truncated: window.truncated, ...(window.nextOffset ? { nextOffset: window.nextOffset } : {}) },
    };
  }

  private assertRecordTarget(rootId: MemoryRootId, target: string, record: MemoryRecord): void {
    const descriptor = this.descriptor(rootId);
    const relativePath = relative(descriptor.path, target);
    if (rootId === "memory:archive") throw new Error("Archive memory is read-only; use the archive lifecycle operation.");
    if (rootId === "memory:candidates") {
      if (record.status !== "candidate" || relativePath !== `${record.id}.md`) throw new Error("Candidate memory path or status is invalid.");
      return;
    }
    if (rootId === "memory:user") {
      if (record.scope.kind !== "user" || relativePath !== `${record.type}/${record.id}.md`) throw new Error("User memory scope or path is invalid.");
      return;
    }
    if (!this.projectId || record.scope.kind !== "project" || record.scope.projectId !== this.projectId || relativePath !== `${record.type}/${record.id}.md`) {
      throw new Error("Project memory scope or path is invalid.");
    }
  }

  private inputFromRecord(record: MemoryRecord) {
    return {
      id: record.id,
      type: record.type,
      scope: record.scope,
      description: record.description,
      content: record.content,
      confidence: record.confidence,
      source: {
        ...record.source,
        ...(this.context ? { sessionId: this.context.sessionId, nodeId: this.context.nodeId } : {}),
      },
      lastConfirmedAt: record.lastConfirmedAt,
      supersedes: record.supersedes,
      dedupeKey: record.dedupeKey,
    };
  }

  private async withMutationQueue<T>(root: MemoryRootId, path: string, operation: () => Promise<T>): Promise<T> {
    const resolved = await this.safeTarget(root, path, false);
    const key = `${root}\u0000${resolve(resolved.target)}`;
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    let releaseNext!: () => void;
    const next = new Promise<void>((resolveNext) => {
      releaseNext = resolveNext;
    });
    const chained = previous.then(() => next);
    this.mutationQueues.set(key, chained);
    await previous;
    try {
      return await operation();
    } finally {
      releaseNext();
      if (this.mutationQueues.get(key) === chained) this.mutationQueues.delete(key);
    }
  }

  async write(input: MemoryWriteInput): Promise<{ path: string; operation: "create" | "overwrite"; bytes: number; version: string; record?: MemoryRecord }> {
    return this.withMutationQueue(input.root, input.path, () => this.writeUnlocked(input));
  }

  private async writeUnlocked(input: MemoryWriteInput): Promise<{ path: string; operation: "create" | "overwrite"; bytes: number; version: string; record?: MemoryRecord }> {
    const resolved = await this.safeTarget(input.root, input.path, false);
    let current: { version: string } | undefined;
    try {
      const stat = await fs.stat(resolved.target);
      if (!stat.isFile()) throw new Error("Memory target is not a file.");
      current = { version: fileVersion(stat) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current && input.overwrite !== true) throw new Error("Memory target already exists; pass overwrite: true to replace it.");
    if (current && input.expectedVersion === undefined) throw new Error("Read the memory file first and pass expectedVersion before writing.");
    if (input.expectedVersion !== undefined && input.expectedVersion !== current?.version) throw new Error("Memory target changed since it was read; read it again before writing.");
    const record = recordFromMarkdown(input.content, resolved.target);
    this.assertRecordTarget(input.root, resolved.target, record);
    if (input.root === "memory:candidates") {
      const saved = current ? await this.store.edit(record.id, this.inputFromRecord(record)) : await this.store.createCandidate({ ...this.inputFromRecord(record), source: record.source });
      if (!saved) throw new Error("Candidate memory could not be saved.");
      this.onPrimaryWrite?.(saved);
      const stat = await fs.stat(saved.path ?? resolved.target);
      return { path: resolved.relativePath, operation: current ? "overwrite" : "create", bytes: Buffer.byteLength(input.content, "utf8"), version: fileVersion(stat), record: saved };
    }
    const saved = await this.store.remember(this.inputFromRecord(record));
    const stat = await fs.stat(saved.path!);
    this.onPrimaryWrite?.(saved);
    return { path: resolved.relativePath, operation: current ? "overwrite" : "create", bytes: Buffer.byteLength(input.content, "utf8"), version: fileVersion(stat), record: saved };
  }

  async edit(input: MemoryEditInput): Promise<{ path: string; replacements: number; bytes: number; version: string; record?: MemoryRecord }> {
    return this.withMutationQueue(input.root, input.path, () => this.editUnlocked(input));
  }

  private async editUnlocked(input: MemoryEditInput): Promise<{ path: string; replacements: number; bytes: number; version: string; record?: MemoryRecord }> {
    const resolved = await this.safeTarget(input.root, input.path, true);
    const stat = await fs.stat(resolved.target);
    const version = fileVersion(stat);
    if (input.expectedVersion === undefined) throw new Error("Read the memory file first and pass expectedVersion before editing.");
    if (input.expectedVersion !== version) throw new Error("Memory target changed since it was read; read it again before editing.");
    const before = await fs.readFile(resolved.target, "utf8");
    if (!input.oldText) throw new Error("oldText must not be empty.");
    const matches = before.split(input.oldText).length - 1;
    if (matches === 0) throw new Error("oldText was not found in the memory target.");
    if (!input.replaceAll && matches !== 1) throw new Error(`oldText matched ${matches} times; set replaceAll: true to replace all matches.`);
    const content = input.replaceAll ? before.split(input.oldText).join(input.newText) : before.replace(input.oldText, input.newText);
    const result = await this.writeUnlocked({ root: input.root, path: input.path, content, overwrite: true, expectedVersion: version });
    return { path: result.path, replacements: input.replaceAll ? matches : 1, bytes: result.bytes, version: result.version, record: result.record };
  }
}
