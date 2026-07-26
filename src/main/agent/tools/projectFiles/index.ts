import { promises as fs } from "fs";
import { basename, relative, resolve } from "path";
import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../../core/tool";
import { limitText, textResult } from "../../core/tool";

const DEFAULT_READ_LIMIT = 32_000;
const MAX_READ_LIMIT = 128_000;
const DEFAULT_MAX_ENTRIES = 200;
const MAX_ENTRIES = 1000;

function rootsOf(sourceFolders: string[]): string[] {
  return [...new Set(sourceFolders.map((folder) => resolve(folder)).filter(Boolean))];
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(".."));
}

function resolveRoot(sourceFolders: string[], requested?: string): string {
  const roots = rootsOf(sourceFolders);
  if (roots.length === 0) throw new Error("No source folders are configured for this Project.");
  if (!requested) return roots[0];
  const root = resolve(requested);
  if (!roots.some((allowed) => allowed === root)) {
    throw new Error("Requested root is not one of this Project's source folders.");
  }
  return root;
}

function resolveInside(root: string, inputPath = "."): string {
  const target = resolve(root, inputPath);
  if (!inside(root, target)) throw new Error("Path is outside this Project's source folders.");
  return target;
}

export function createProjectFileTools(sourceFolders: string[]): ReadonlyAgentTool[] {
  const roots = rootsOf(sourceFolders);
  if (roots.length === 0) return [];

  const listFiles: ReadonlyAgentTool<{ root?: string; path?: string; maxEntries?: number }, unknown> = {
    name: "project_list_files",
    label: "List Project Files",
    description: "List files and folders inside the current Loom Project's source folders.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One of the Project source folder absolute paths. Defaults to the first source folder." })),
      path: Type.Optional(Type.String({ description: "Relative path inside the selected source folder. Defaults to project root." })),
      maxEntries: Type.Optional(Type.Number({ description: "Maximum entries to return." })),
    }),
    readOnly: true,
    execute: async ({ args }) => {
      const root = resolveRoot(roots, args.root);
      const dir = resolveInside(root, args.path ?? ".");
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) throw new Error("Path is not a directory.");
      const maxEntries = Math.max(1, Math.min(MAX_ENTRIES, Number(args.maxEntries ?? DEFAULT_MAX_ENTRIES)));
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const rows = entries
        .slice(0, maxEntries)
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .join("\n");
      const omitted = Math.max(0, entries.length - maxEntries);
      const suffix = omitted > 0 ? `\n... ${omitted} more` : "";
      return textResult(rows + suffix, {
        root,
        path: relative(root, dir) || ".",
        totalEntries: entries.length,
        returnedEntries: Math.min(entries.length, maxEntries),
      });
    },
  };

  const readFile: ReadonlyAgentTool<{ root?: string; path: string; limit?: number }, unknown> = {
    name: "project_read_file",
    label: "Read Project File",
    description: "Read bounded UTF-8 text from a file inside the current Loom Project's source folders.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One of the Project source folder absolute paths. Defaults to the first source folder." })),
      path: Type.String({ description: "Relative file path inside the selected source folder." }),
      limit: Type.Optional(Type.Number({ description: "Maximum characters to return." })),
    }),
    readOnly: true,
    execute: async ({ args }) => {
      const root = resolveRoot(roots, args.root);
      const file = resolveInside(root, args.path);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error("Path is not a file.");
      const raw = await fs.readFile(file, "utf-8");
      const limit = Math.max(0, Math.min(MAX_READ_LIMIT, Number(args.limit ?? DEFAULT_READ_LIMIT)));
      const limited = limitText(raw, limit);
      return textResult(limited.text, {
        root,
        path: relative(root, file) || basename(file),
        bytes: stat.size,
        truncation: limited.truncation,
      });
    },
  };

  return [listFiles, readFile];
}
