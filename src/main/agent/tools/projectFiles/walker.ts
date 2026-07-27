import { promises as fs } from "fs";
import { join } from "path";
import { abortIfNeeded, isWithinRoot, relativeProjectPath, resolveInside, type ProjectRoot } from "./access";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
export const MAX_SCANNED_ENTRIES = 20_000;

export interface WalkedProjectFile {
  absolutePath: string;
  relativePath: string;
}

export interface WalkResult {
  files: WalkedProjectFile[];
  scannedEntries: number;
  scanLimitReached: boolean;
}

export async function walkProjectFiles(root: ProjectRoot, inputPath: string | undefined, signal?: AbortSignal): Promise<WalkResult> {
  const start = await resolveInside(root, inputPath ?? ".");
  const files: WalkedProjectFile[] = [];
  const visitedDirectories = new Set<string>();
  let scannedEntries = 0;
  let scanLimitReached = false;

  async function visit(target: string): Promise<void> {
    abortIfNeeded(signal);
    if (scannedEntries >= MAX_SCANNED_ENTRIES) {
      scanLimitReached = true;
      return;
    }
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      files.push({ absolutePath: target, relativePath: relativeProjectPath(root, target) });
      return;
    }
    if (!stat.isDirectory()) return;
    const canonical = await fs.realpath(target);
    if (!isWithinRoot(root, canonical)) throw new Error("Path is outside this Project's source folders.");
    if (visitedDirectories.has(canonical)) return;
    visitedDirectories.add(canonical);
    const entries = await fs.readdir(canonical, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      abortIfNeeded(signal);
      if (scannedEntries >= MAX_SCANNED_ENTRIES) {
        scanLimitReached = true;
        return;
      }
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      scannedEntries += 1;
      const entryPath = join(canonical, entry.name);
      const realPath = await fs.realpath(entryPath);
      if (!isWithinRoot(root, realPath)) throw new Error("Path is outside this Project's source folders.");
      await visit(realPath);
      if (scanLimitReached) return;
    }
  }

  await visit(start);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, scannedEntries, scanLimitReached };
}
