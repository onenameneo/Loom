import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { markdownForRecord, normalizeDedupeKey, recordFromMarkdown, stableMemoryId } from "./markdown";
import type {
  MemoryCandidateInput,
  MemoryIssue,
  MemoryRecord,
  MemoryScan,
  MemoryScope,
  MemoryStats,
  MemoryWriteInput,
} from "./types";
import { isMemoryScope, isMemoryType, normalizeConfidence } from "./types";

export const MEMORY_INDEX_FILE = "MEMORY.md";
export const MEMORY_STATE_FILE = ".autodream-state.json";
export const MEMORY_LOCK_FILE = ".autodream.lock";

export interface MemoryStoreOptions {
  rootDir: string;
  now?: () => number;
}

export interface MemoryPreview {
  record: MemoryRecord;
  markdown: string;
}

export class MemoryStore {
  readonly rootDir: string;
  private readonly now: () => number;
  private initialized = false;

  constructor(options: MemoryStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      fs.mkdir(join(this.rootDir, "user"), { recursive: true }),
      fs.mkdir(join(this.rootDir, "feedback"), { recursive: true }),
      fs.mkdir(join(this.rootDir, "reference"), { recursive: true }),
      fs.mkdir(join(this.rootDir, "projects"), { recursive: true }),
      fs.mkdir(join(this.rootDir, "candidates"), { recursive: true }),
      fs.mkdir(join(this.rootDir, "archive"), { recursive: true }),
    ]);
    const indexPath = this.confinedPath(MEMORY_INDEX_FILE);
    try {
      await fs.access(indexPath);
    } catch {
      await this.atomicWrite(indexPath, "# Loom Memory\n\n> This index is generated from Markdown memory files.\n");
    }
    const statePath = this.confinedPath(MEMORY_STATE_FILE);
    try {
      await fs.access(statePath);
    } catch {
      await this.atomicWrite(statePath, JSON.stringify({ version: 1, newSessions: 0 }, null, 2) + "\n");
    }
    this.initialized = true;
  }

  private confinedPath(...parts: string[]): string {
    const target = resolve(this.rootDir, ...parts);
    const root = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;
    if (target !== this.rootDir && !target.startsWith(root)) throw new Error("Memory path escapes the configured memory root.");
    return target;
  }

  private async assertExistingPathConfined(path: string): Promise<void> {
    const target = this.confinedPath(path);
    try {
      const realRoot = await fs.realpath(this.rootDir);
      const realTarget = await fs.realpath(target);
      const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
      if (realTarget !== realRoot && !realTarget.startsWith(prefix)) throw new Error("Memory path escapes through a symlink.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const target = this.confinedPath(path);
    await this.assertExistingPathConfined(target);
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
      await fs.rename(tmp, target);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private locationFor(record: MemoryRecord, bucket: "active" | "candidate" | "archive"): string {
    const filename = `${record.id}.md`;
    if (bucket === "candidate") return this.confinedPath("candidates", filename);
    if (bucket === "archive") return this.confinedPath("archive", `${record.id}-${record.updatedAt}.md`);
    if (record.scope.kind === "project") return this.confinedPath("projects", record.scope.projectId, record.type, filename);
    return this.confinedPath(record.type, filename);
  }

  private validateInput(input: MemoryWriteInput): void {
    if (input.id && (!/^[A-Za-z0-9._-]+$/.test(input.id) || input.id.includes(".."))) throw new Error("Memory id contains an unsafe path segment.");
    if (!isMemoryType(input.type)) throw new Error(`Unsupported memory type: ${String(input.type)}`);
    if (!isMemoryScope(input.scope)) throw new Error("Memory scope is invalid or missing a project id.");
    if (input.scope.kind === "project" && (!/^[A-Za-z0-9._-]+$/.test(input.scope.projectId) || input.scope.projectId.includes(".."))) throw new Error("Project scope contains an unsafe path segment.");
    if (!input.description.trim() || !input.content.trim()) throw new Error("Memory description and content are required.");
    if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1 || !Number.isFinite(input.confidence))) {
      throw new Error("Memory confidence must be between 0 and 1.");
    }
  }

  private toRecord(input: MemoryWriteInput, status: MemoryRecord["status"]): MemoryRecord {
    this.validateInput(input);
    const now = this.now();
    const dedupeKey = input.dedupeKey ? normalizeDedupeKey(input.dedupeKey) : normalizeDedupeKey(`${input.type}:${input.description}:${input.content}`);
    return {
      id: input.id?.trim() || stableMemoryId(input.type, input.scope, dedupeKey),
      type: input.type,
      scope: input.scope,
      status,
      confidence: normalizeConfidence(input.confidence),
      description: input.description.trim(),
      content: input.content.trim(),
      source: {
        trigger: input.source?.trigger ?? "manual",
        sessionId: input.source?.sessionId,
        nodeId: input.source?.nodeId,
        excerpt: input.source?.excerpt,
      },
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: input.lastConfirmedAt,
      supersedes: input.supersedes,
      dedupeKey,
    };
  }

  private async walk(dir: string, output: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "archive" || entry.name === "MEMORY.md" || entry.name === MEMORY_STATE_FILE || entry.name === MEMORY_LOCK_FILE) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await this.walk(path, output);
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) output.push(path);
    }
    const archive = join(this.rootDir, "archive");
    if (dir === this.rootDir) await this.walkArchive(archive, output);
  }

  private async walkArchive(dir: string, output: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await this.walkArchive(path, output);
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) output.push(path);
    }
  }

  async scan(): Promise<MemoryScan> {
    await this.initialize();
    const paths: string[] = [];
    await this.walk(this.rootDir, paths);
    const records: MemoryRecord[] = [];
    const issues: MemoryIssue[] = [];
    for (const path of paths) {
      try {
        await this.assertExistingPathConfined(path);
        const record = recordFromMarkdown(await fs.readFile(path, "utf8"), path);
        records.push(record);
      } catch (error) {
        issues.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { records, issues };
  }

  async listRecords(options: { projectId?: string; includeArchived?: boolean } = {}): Promise<MemoryScan> {
    const scan = await this.scan();
    scan.records = scan.records.filter((record) => {
      if (!options.includeArchived && (record.status === "archived" || record.status === "rejected")) return false;
      if (!options.projectId) return record.scope.kind === "user";
      return record.scope.kind === "user" || record.scope.projectId === options.projectId;
    });
    return scan;
  }

  async find(id: string): Promise<MemoryRecord | undefined> {
    const scan = await this.scan();
    return scan.records.find((record) => record.id === id);
  }

  async preview(id: string): Promise<MemoryPreview | undefined> {
    const record = await this.find(id);
    if (!record || !record.path) return undefined;
    return { record, markdown: await fs.readFile(record.path, "utf8") };
  }

  async remember(input: MemoryWriteInput): Promise<MemoryRecord> {
    await this.initialize();
    const candidate = this.toRecord(input, "active");
    const scan = await this.scan();
    const duplicate = scan.records.find((record) =>
      record.status === "active" && record.dedupeKey === candidate.dedupeKey &&
      JSON.stringify(record.scope) === JSON.stringify(candidate.scope),
    );
    const record = duplicate
      ? { ...duplicate, ...candidate, id: duplicate.id, createdAt: duplicate.createdAt, status: "active" as const }
      : candidate;
    await this.writeActive(record);
    return record;
  }

  async edit(id: string, patch: Partial<MemoryWriteInput>): Promise<MemoryRecord | undefined> {
    const current = await this.find(id);
    if (!current || current.status === "archived" || current.status === "rejected") return undefined;
    const next: MemoryWriteInput = {
      id: current.id,
      type: patch.type ?? current.type,
      scope: patch.scope ?? current.scope,
      description: patch.description ?? current.description,
      content: patch.content ?? current.content,
      confidence: patch.confidence ?? current.confidence,
      source: patch.source ?? current.source,
      lastConfirmedAt: patch.lastConfirmedAt ?? current.lastConfirmedAt,
      supersedes: patch.supersedes ?? current.supersedes,
      dedupeKey: patch.dedupeKey ?? current.dedupeKey,
    };
    const updated = this.toRecord(next, current.status === "candidate" ? "candidate" : "active");
    updated.createdAt = current.createdAt;
    updated.updatedAt = this.now();
    if (current.path && current.status === "candidate") {
      await this.atomicWrite(this.locationFor(updated, "candidate"), markdownForRecord(updated));
      if (current.path !== this.locationFor(updated, "candidate")) await fs.rm(current.path, { force: true });
    } else {
      await this.writeActive(updated);
      if (current.path && current.path !== this.locationFor(updated, "active")) await fs.rm(current.path, { force: true });
    }
    return updated;
  }

  async createCandidate(input: MemoryCandidateInput): Promise<MemoryRecord | undefined> {
    await this.initialize();
    const candidate = this.toRecord(input, "candidate");
    const scan = await this.scan();
    const duplicate = scan.records.find((record) => record.dedupeKey === candidate.dedupeKey && JSON.stringify(record.scope) === JSON.stringify(candidate.scope));
    if (duplicate) return duplicate;
    candidate.path = this.locationFor(candidate, "candidate");
    await this.atomicWrite(candidate.path, markdownForRecord(candidate));
    await this.rebuildIndex();
    return candidate;
  }

  async approveCandidate(id: string, overrides: Partial<Pick<MemoryRecord, "description" | "content" | "type" | "scope" | "confidence">> = {}): Promise<MemoryRecord | undefined> {
    const current = await this.find(id);
    if (!current || current.status !== "candidate") return undefined;
    const active: MemoryRecord = { ...current, ...overrides, status: "active", updatedAt: this.now(), source: { ...current.source, trigger: "manual" } };
    await this.writeActive(active);
    if (current.path) await fs.rm(current.path, { force: true });
    await this.rebuildIndex();
    return active;
  }

  async rejectCandidate(id: string, reason = "rejected by user"): Promise<MemoryRecord | undefined> {
    const current = await this.find(id);
    if (!current || current.status !== "candidate") return undefined;
    return this.archiveRecord(current, reason, "rejected");
  }

  async archive(id: string, reason = "archived by user"): Promise<MemoryRecord | undefined> {
    const current = await this.find(id);
    return current ? this.archiveRecord(current, reason, "archived") : undefined;
  }

  private async archiveRecord(current: MemoryRecord, reason: string, status: "archived" | "rejected"): Promise<MemoryRecord> {
    const archived = { ...current, status, archivedReason: reason, updatedAt: this.now() };
    await this.atomicWrite(this.locationFor(archived, "archive"), markdownForRecord(archived));
    if (current.path) await fs.rm(current.path, { force: true });
    await this.rebuildIndex();
    return archived;
  }

  async forget(id: string, reason = "forgotten by user"): Promise<MemoryRecord | undefined> {
    return this.archive(id, reason);
  }

  private async writeActive(record: MemoryRecord): Promise<void> {
    const path = this.locationFor(record, "active");
    record.path = path;
    await this.atomicWrite(path, markdownForRecord({ ...record, path }));
    await this.rebuildIndex();
  }

  async rebuildIndex(): Promise<void> {
    await this.initialize();
    const scan = await this.scan();
    const active = scan.records
      .filter((record) => record.status === "active" || record.status === "stale" || record.status === "conflicted")
      .sort((a, b) => a.type.localeCompare(b.type) || a.description.localeCompare(b.description) || a.id.localeCompare(b.id));
    const lines = ["# Loom Memory", "", "> This index is generated from Markdown memory files.", ""];
    for (const record of active) {
      const scope = record.scope.kind === "project" ? `project:${record.scope.projectId}` : "user";
      lines.push(`- [${record.type}] ${record.id} — ${record.description} (${scope}, ${record.status})`);
    }
    if (active.length === 0) lines.push("- No active memories yet.");
    lines.push("");
    await this.atomicWrite(MEMORY_INDEX_FILE, lines.join("\n"));
  }

  async stats(): Promise<MemoryStats> {
    const scan = await this.scan();
    return {
      active: scan.records.filter((record) => record.status === "active").length,
      candidates: scan.records.filter((record) => record.status === "candidate").length,
      archived: scan.records.filter((record) => record.status === "archived" || record.status === "rejected").length,
      stale: scan.records.filter((record) => record.status === "stale").length,
      conflicted: scan.records.filter((record) => record.status === "conflicted").length,
      issues: scan.issues.length,
    };
  }

  async readOperationalState<T extends object>(fallback: T): Promise<T> {
    await this.initialize();
    try {
      const raw = JSON.parse(await fs.readFile(this.confinedPath(MEMORY_STATE_FILE), "utf8"));
      return raw && typeof raw === "object" ? { ...fallback, ...raw } as T : fallback;
    } catch {
      return fallback;
    }
  }

  async writeOperationalState(state: Record<string, unknown>): Promise<void> {
    await this.atomicWrite(MEMORY_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  }

  async acquireLock(now = this.now(), staleAfterMs = 30 * 60_000): Promise<boolean> {
    await this.initialize();
    const path = this.confinedPath(MEMORY_LOCK_FILE);
    try {
      const existing = JSON.parse(await fs.readFile(path, "utf8")) as { acquiredAt?: number };
      if (typeof existing.acquiredAt === "number" && now - existing.acquiredAt < staleAfterMs) return false;
      await fs.rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.writeFile(path, JSON.stringify({ acquiredAt: now, pid: process.pid }) + "\n", { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  async releaseLock(): Promise<void> {
    await fs.rm(this.confinedPath(MEMORY_LOCK_FILE), { force: true });
  }

  async incrementNewSessions(): Promise<number> {
    const state = await this.readOperationalState({ version: 1, newSessions: 0 });
    const newSessions = Math.max(0, Number(state.newSessions ?? 0) + 1);
    await this.writeOperationalState({ ...state, newSessions });
    return newSessions;
  }

  async clearNewSessions(): Promise<void> {
    const state = await this.readOperationalState({ version: 1, newSessions: 0 });
    await this.writeOperationalState({ ...state, newSessions: 0 });
  }

  getRelativePath(path: string): string {
    const target = this.confinedPath(path);
    const value = relative(this.rootDir, target);
    return value || ".";
  }
}

export function defaultMemoryRoot(homeDir: string, configuredRoot?: string): string {
  return configuredRoot?.trim() || join(homeDir, ".loom", "memory");
}
