import { promises as fs } from "fs";
import { join } from "path";
import { abortIfNeeded, isWithinRoot, relativeProjectPath, resolveInside, type ProjectRoot } from "./access";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
export const MAX_SCANNED_ENTRIES = 20_000;

interface IgnoreRule {
  pattern: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

function globPatternToRegex(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (char === "?") {
      result += "[^/]";
    } else {
      result += char.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
    }
  }
  return result;
}

function parseGitignore(contents: string): IgnoreRule[] {
  return contents.split(/\r?\n/).flatMap((line) => {
    let pattern = line.trim();
    if (!pattern || pattern.startsWith("#")) return [];
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    const directoryOnly = pattern.endsWith("/");
    pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!pattern) return [];
    const hasSlash = pattern.includes("/");
    const glob = globPatternToRegex(pattern);
    const source = hasSlash ? `^${glob}(?:/.*)?$` : `(?:^|/)${glob}(?:/.*)?$`;
    return [{ pattern: new RegExp(source), negated, directoryOnly }];
  });
}

function createGitignoreMatcher(contents: string | undefined) {
  const rules = contents ? parseGitignore(contents) : [];
  return (relativePath: string, isDirectory: boolean) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.pattern.test(relativePath)) ignored = !rule.negated;
    }
    return ignored;
  };
}

async function loadGitignore(root: ProjectRoot): Promise<ReturnType<typeof createGitignoreMatcher>> {
  try {
    return createGitignoreMatcher(await fs.readFile(join(root.realPath, ".gitignore"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return createGitignoreMatcher(undefined);
  }
}

export interface WalkedProjectFile {
  absolutePath: string;
  relativePath: string;
}

export interface WalkResult {
  files: WalkedProjectFile[];
  scannedEntries: number;
  scanLimitReached: boolean;
}

export async function walkProjectFiles(
  root: ProjectRoot,
  inputPath: string | undefined,
  signal?: AbortSignal,
  options: { skipUnsafeSymlinks?: boolean; skipHidden?: boolean; respectGitignore?: boolean } = {},
): Promise<WalkResult> {
  const start = await resolveInside(root, inputPath ?? ".");
  const isIgnored = options.respectGitignore ? await loadGitignore(root) : undefined;
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
    if (!isWithinRoot(root, canonical)) throw new Error("Path is outside this Project's source roots.");
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
      if (options.skipHidden && entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      scannedEntries += 1;
      const entryPath = join(canonical, entry.name);
      let realPath: string;
      try {
        realPath = await fs.realpath(entryPath);
      } catch (error) {
        if (options.skipUnsafeSymlinks && entry.isSymbolicLink()) continue;
        throw error;
      }
      if (!isWithinRoot(root, realPath)) {
        if (options.skipUnsafeSymlinks && entry.isSymbolicLink()) continue;
        throw new Error("Path is outside this Project's source roots.");
      }
      if (isIgnored?.(relativeProjectPath(root, realPath), entry.isDirectory())) continue;
      await visit(realPath);
      if (scanLimitReached) return;
    }
  }

  await visit(start);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, scannedEntries, scanLimitReached };
}
