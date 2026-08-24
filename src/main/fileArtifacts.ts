import { randomUUID } from "node:crypto";
import { promises as fs, realpathSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type {
  FileArtifactAction,
  FileArtifactActionResult,
  FileArtifactKind,
  FileArtifactOperation,
  FileArtifactProjectIdentity,
  FileArtifactRecord,
  FileArtifactRef,
} from "../common/fileArtifacts";
import { fileVersion } from "./agent/tools/projectFiles/access";

export interface FileArtifactRegistrationInput {
  id?: string;
  absolutePath: string;
  name?: string;
  displayPath?: string;
  kind: FileArtifactKind;
  operation: FileArtifactOperation;
  project?: FileArtifactProjectIdentity;
  version?: string;
}

export type FileArtifactResolution = {
  ok: true;
  record: FileArtifactRecord;
} | {
  ok: false;
  error: NonNullable<FileArtifactActionResult["error"]>;
  message: string;
};

const highRiskExtensions = new Set([
  ".app", ".bat", ".cmd", ".com", ".command", ".exe", ".msi", ".ps1", ".sh", ".vb", ".vbs", ".workflow",
]);

function publicRef(record: FileArtifactRecord): FileArtifactRef {
  const { absolutePath: _absolutePath, ...ref } = record;
  return ref;
}

function isHighRiskPath(path: string): boolean {
  return highRiskExtensions.has(extname(path).toLowerCase()) || path.toLowerCase().endsWith(".app");
}

export class FileArtifactRegistry {
  private readonly records = new Map<string, FileArtifactRecord>();

  register(input: FileArtifactRegistrationInput): { ref: FileArtifactRef; record: FileArtifactRecord } {
    const absolutePath = realpathSync(resolve(input.absolutePath));
    const stat = statSync(absolutePath);
    if (!stat.isFile()) throw new Error("Artifact path is not a file.");
    const record: FileArtifactRecord = {
      id: input.id ?? `artifact_${randomUUID().replaceAll("-", "")}`,
      name: input.name || basename(absolutePath),
      displayPath: input.displayPath || absolutePath,
      kind: input.kind,
      operation: input.operation,
      status: "available",
      ...(input.project ? { project: input.project } : {}),
      version: input.version ?? fileVersion(stat),
      absolutePath,
    };
    this.records.set(record.id, record);
    return { record: { ...record }, ref: publicRef(record) };
  }

  registerRecord(input: FileArtifactRecord): { ref: FileArtifactRef; record: FileArtifactRecord } {
    return this.register(input);
  }

  get(id: string): FileArtifactRef | undefined {
    const record = this.records.get(id);
    return record ? publicRef(record) : undefined;
  }

  resolve(id: string, action: FileArtifactAction): FileArtifactResolution {
    const record = this.records.get(id);
    if (!record) return { ok: false, error: "not-found", message: "File artifact was not found." };
    if (action === "preview" && !record.project) return { ok: false, error: "unsupported", message: "Only project files can be previewed in Loom." };
    if (action === "open" && isHighRiskPath(record.absolutePath)) return { ok: false, error: "unsupported", message: "This file type can only be revealed in its folder." };
    let currentPath: string;
    try {
      currentPath = realpathSync(record.absolutePath);
      const stat = statSync(currentPath);
      if (!stat.isFile()) throw new Error("not a file");
      if (currentPath !== record.absolutePath || fileVersion(stat) !== record.version) {
        return { ok: false, error: "stale", message: "The generated file changed or was replaced." };
      }
    } catch {
      return { ok: false, error: "unavailable", message: "The generated file is no longer available." };
    }
    return { ok: true, record: { ...record, status: "available", absolutePath: currentPath } };
  }

  clear(): void {
    this.records.clear();
  }
}

export async function revealFile(path: string, showItemInFolder: (path: string) => void): Promise<void> {
  await fs.access(path);
  showItemInFolder(path);
}

export function isHighRiskArtifact(path: string): boolean {
  return isHighRiskPath(path);
}
