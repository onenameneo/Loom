import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_AGENTS_TEMPLATE = `# Project Agent Instructions

This file contains project-level instructions for agents working in this directory.

## Loom

- Project settings: \`.loom/settings.json\`
- Project skills: \`.loom/skills/\`

Add project-specific instructions below.
`;

const PROJECT_SETTINGS_TEMPLATE = "{}\n";

type ExistingEntry = ReturnType<typeof lstatSync> | undefined;

function existingEntry(path: string): ExistingEntry {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function describeEntry(path: string): string {
  return `Project initialization path is not a compatible file or directory: ${path}`;
}

function validateSourceRoot(sourceRoot: string): void {
  const entry = existingEntry(sourceRoot);
  if (!entry?.isDirectory()) {
    throw new Error(`Project source root must be an existing directory: ${sourceRoot}`);
  }
}

function validateFilePath(path: string): void {
  const entry = existingEntry(path);
  if (entry && !entry.isFile()) throw new Error(describeEntry(path));
}

function validateDirectoryPath(path: string): void {
  const entry = existingEntry(path);
  if (entry && !entry.isDirectory()) throw new Error(describeEntry(path));
}

function createFileIfMissing(path: string, content: string): void {
  validateFilePath(path);
  if (existingEntry(path)) return;

  try {
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    validateFilePath(path);
  }
}

function normalizedRoots(sourceRoots: readonly string[]): string[] {
  return [...new Set(sourceRoots.map((root) => root.trim()).filter(Boolean).map((root) => resolve(root)))];
}

function validateRootPlan(sourceRoots: readonly string[]): void {
  for (const root of sourceRoots) {
    validateSourceRoot(root);
    validateFilePath(join(root, "AGENTS.md"));
    validateDirectoryPath(join(root, ".loom"));

    const loom = join(root, ".loom");
    validateFilePath(join(loom, "settings.json"));
    validateDirectoryPath(join(loom, "skills"));
  }
}

function initializeRoot(root: string): void {
  createFileIfMissing(join(root, "AGENTS.md"), PROJECT_AGENTS_TEMPLATE);

  const loom = join(root, ".loom");
  mkdirSync(loom, { recursive: true });
  createFileIfMissing(join(loom, "settings.json"), PROJECT_SETTINGS_TEMPLATE);
  mkdirSync(join(loom, "skills"), { recursive: true });
}

/**
 * Initializes only the project-local files owned by Loom.
 *
 * The caller is responsible for invoking this before persisting the Project.
 * Existing user files are intentionally treated as immutable input.
 */
export function initializeProjectDirectories(sourceRoots: readonly string[]): void {
  const roots = normalizedRoots(sourceRoots);
  validateRootPlan(roots);
  for (const root of roots) initializeRoot(root);
}
