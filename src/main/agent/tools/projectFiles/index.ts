import { promises as fs } from "fs";
import { join } from "path";
import { Type } from "typebox";
import type { AgentTool, ReadonlyAgentTool } from "../../core/tool";
import { textResult } from "../../core/tool";
import {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_LINES,
  MAX_ENTRIES,
  MAX_LINES,
  MAX_OUTPUT_CHARS,
  abortIfNeeded,
  atomicReplaceUtf8,
  boundedMutationDiffDetails,
  appendBounded,
  boundedInteger,
  canonicalApprovalTarget,
  relativeProjectPath,
  resolveExistingFile,
  resolveInside,
  resolveMutationTarget,
  selectProjectRoot,
  withFileMutationQueue,
} from "./access";
import { walkProjectFiles } from "./walker";

const DEFAULT_FIND_LIMIT = 500;
const DEFAULT_GREP_LIMIT = 100;

function globRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(source + "$");
}

function numberedLines(lines: string[], offset: number): string[] {
  return lines.map((line, index) => `${String(offset + index).padStart(6, " ")} | ${line}`);
}

function textFromBuffer(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function truncation(reason?: string) {
  return { truncated: Boolean(reason), reason };
}

export function createProjectFileTools(sourceFolders: string[]): ReadonlyAgentTool[] {
  if (sourceFolders.length === 0) return [];

  const listFiles: ReadonlyAgentTool<{ root?: string; path?: string; maxEntries?: number }, unknown> = {
    name: "project_list_files",
    label: "List Project Files",
    description: "List direct files and folders inside one source folder of the current Loom Project.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.Optional(Type.String({ description: "Relative directory path inside the selected source folder." })),
      maxEntries: Type.Optional(Type.Number({ description: "Maximum entries to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const directory = await resolveInside(root, args.path ?? ".");
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) throw new Error("Path is not a directory.");
      const maxEntries = boundedInteger(args.maxEntries, DEFAULT_MAX_ENTRIES, MAX_ENTRIES);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const lines: string[] = [];
      let outputLimitReached = false;
      for (const entry of entries.slice(0, maxEntries)) {
        abortIfNeeded(signal);
        await resolveInside(root, relativeProjectPath(root, join(directory, entry.name)));
        const type = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "link" : "other";
        if (!appendBounded(lines, `${type} ${entry.name}`)) {
          outputLimitReached = true;
          break;
        }
      }
      const returnedEntries = lines.length;
      const reason = outputLimitReached ? "output" : entries.length > maxEntries ? "entries" : undefined;
      return textResult(lines.join("\n"), {
        path: relativeProjectPath(root, directory),
        returnedEntries,
        totalEntries: entries.length,
        truncation: truncation(reason),
      });
    },
  };

  const readFile: ReadonlyAgentTool<{ root?: string; path: string; offset?: number; limit?: number }, unknown> = {
    name: "project_read_file",
    label: "Read Project File",
    description: "Read a bounded, numbered UTF-8 text range from a file inside the current Loom Project.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.String({ description: "Relative file path inside the selected source folder." }),
      offset: Type.Optional(Type.Number({ description: "1-based first line to return." })),
      limit: Type.Optional(Type.Number({ description: "Maximum lines to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const file = await resolveInside(root, args.path);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error("Path is not a file.");
      const offset = boundedInteger(args.offset, 1, Number.MAX_SAFE_INTEGER);
      const limit = boundedInteger(args.limit, DEFAULT_MAX_LINES, MAX_LINES);
      const raw = textFromBuffer(await fs.readFile(file));
      abortIfNeeded(signal);
      const allLines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (allLines.length > 1 && allLines.at(-1) === "") allLines.pop();
      const selected = allLines.slice(offset - 1, offset - 1 + limit);
      const lines: string[] = [];
      let outputLimitReached = false;
      for (const line of numberedLines(selected, offset)) {
        if (!appendBounded(lines, line)) {
          outputLimitReached = true;
          break;
        }
      }
      const reason = outputLimitReached ? "output" : offset - 1 + selected.length < allLines.length ? "lines" : undefined;
      return textResult(lines.join("\n"), {
        path: relativeProjectPath(root, file),
        offset,
        returnedLines: lines.length,
        totalLines: allLines.length,
        truncation: truncation(reason),
      });
    },
  };

  const findFiles: ReadonlyAgentTool<{ root?: string; path?: string; pattern: string; limit?: number }, unknown> = {
    name: "project_find_files",
    label: "Find Project Files",
    description: "Find files by glob pattern inside the current Loom Project source folder.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.Optional(Type.String({ description: "Relative directory or file path to search." })),
      pattern: Type.String({ description: "Glob pattern, for example src/**/*.ts." }),
      limit: Type.Optional(Type.Number({ description: "Maximum matching files to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const pattern = globRegex(args.pattern);
      const limit = boundedInteger(args.limit, DEFAULT_FIND_LIMIT, MAX_ENTRIES);
      const walked = await walkProjectFiles(root, args.path, signal);
      const lines: string[] = [];
      let reason: string | undefined = walked.scanLimitReached ? "scan" : undefined;
      for (const file of walked.files) {
        abortIfNeeded(signal);
        if (!pattern.test(file.relativePath)) continue;
        if (lines.length >= limit) {
          reason = "results";
          break;
        }
        if (!appendBounded(lines, file.relativePath)) {
          reason = "output";
          break;
        }
      }
      return textResult(lines.join("\n"), {
        path: args.path ?? ".",
        returnedFiles: lines.length,
        scannedEntries: walked.scannedEntries,
        truncation: truncation(reason),
      });
    },
  };

  const grep: ReadonlyAgentTool<{
    root?: string; path?: string; pattern: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number;
  }, unknown> = {
    name: "project_grep",
    label: "Search Project Files",
    description: "Search UTF-8 Project files by text or regex and return matching line numbers.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.Optional(Type.String({ description: "Relative directory or file path to search." })),
      pattern: Type.String({ description: "Text or regular expression to search for." }),
      glob: Type.Optional(Type.String({ description: "Optional glob filter, for example **/*.ts." })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Search case-insensitively." })),
      literal: Type.Optional(Type.Boolean({ description: "Treat the pattern as literal text." })),
      context: Type.Optional(Type.Number({ description: "Context lines before and after each match." })),
      limit: Type.Optional(Type.Number({ description: "Maximum matching lines to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const flags = args.ignoreCase ? "i" : "";
      const expression = args.literal
        ? new RegExp(args.pattern.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"), flags)
        : new RegExp(args.pattern, flags);
      const filter = args.glob ? globRegex(args.glob) : undefined;
      const context = boundedInteger(args.context, 0, 20, 0);
      const limit = boundedInteger(args.limit, DEFAULT_GREP_LIMIT, MAX_ENTRIES);
      const walked = await walkProjectFiles(root, args.path, signal);
      const lines: string[] = [];
      let matches = 0;
      let reason: string | undefined = walked.scanLimitReached ? "scan" : undefined;
      for (const file of walked.files) {
        abortIfNeeded(signal);
        if (filter && !filter.test(file.relativePath)) continue;
        let text: string;
        try {
          text = textFromBuffer(await fs.readFile(file.absolutePath));
        } catch {
          continue;
        }
        const fileLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const emitted = new Set<number>();
        for (let index = 0; index < fileLines.length; index += 1) {
          abortIfNeeded(signal);
          expression.lastIndex = 0;
          if (!expression.test(fileLines[index])) continue;
          if (matches >= limit) {
            reason = "results";
            break;
          }
          matches += 1;
          for (let lineIndex = Math.max(0, index - context); lineIndex <= Math.min(fileLines.length - 1, index + context); lineIndex += 1) {
            if (emitted.has(lineIndex)) continue;
            const marker = lineIndex === index ? ":" : "-";
            if (!appendBounded(lines, `${file.relativePath}${marker}${lineIndex + 1}: ${fileLines[lineIndex]}`)) {
              reason = "output";
              break;
            }
            emitted.add(lineIndex);
          }
          if (reason) break;
        }
        if (reason) break;
      }
      return textResult(lines.join("\n"), {
        path: args.path ?? ".",
        matches,
        scannedEntries: walked.scannedEntries,
        truncation: truncation(reason),
      });
    },
  };

  return [readFile, listFiles, findFiles, grep];
}

interface WriteArgs {
  root?: string;
  path: string;
  content: string;
  overwrite?: boolean;
}

interface EditArgs {
  root?: string;
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

function mutationPreviewSummary(args: WriteArgs | EditArgs, kind: "write" | "edit") {
  if (kind === "write") {
    const writeArgs = args as WriteArgs;
    return {
      operation: writeArgs.overwrite ? "overwrite" : "create",
      path: writeArgs.path,
      contentLength: writeArgs.content.length,
      contentBytes: Buffer.byteLength(writeArgs.content, "utf-8"),
    };
  }
  const editArgs = args as EditArgs;
  return {
    operation: editArgs.replaceAll ? "edit-all" : "edit-one",
    path: editArgs.path,
    oldTextLength: editArgs.oldText.length,
    newTextLength: editArgs.newText.length,
    oldTextBytes: Buffer.byteLength(editArgs.oldText, "utf-8"),
    newTextBytes: Buffer.byteLength(editArgs.newText, "utf-8"),
  };
}

async function approvalTargetFor(sourceFolders: string[], rootArg: string | undefined, pathArg: string): Promise<string> {
  const root = await selectProjectRoot(sourceFolders, rootArg);
  const target = await resolveMutationTarget(root, pathArg);
  return canonicalApprovalTarget(target);
}

function countMatches(content: string, oldText: string): number {
  if (oldText.length === 0) throw new Error("oldText must not be empty.");
  let count = 0;
  let index = 0;
  while (true) {
    const next = content.indexOf(oldText, index);
    if (next < 0) return count;
    count += 1;
    index = next + oldText.length;
  }
}

function replaceExact(content: string, oldText: string, newText: string, replaceAll?: boolean): { content: string; replacements: number } {
  const matches = countMatches(content, oldText);
  if (matches === 0) throw new Error("oldText was not found in the target file.");
  if (!replaceAll && matches !== 1) throw new Error(`oldText matched ${matches} times; set replaceAll: true to replace all matches.`);
  return {
    content: replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText),
    replacements: replaceAll ? matches : 1,
  };
}

export function createProjectMutationTools(sourceFolders: string[]): AgentTool[] {
  if (sourceFolders.length === 0) return [];

  const writeFile: AgentTool<WriteArgs, unknown> = {
    name: "project_write_file",
    label: "Write Project File",
    description: "Create or explicitly overwrite a UTF-8 text file inside the current Loom Project source folders.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.String({ description: "Relative file path inside the selected source folder." }),
      content: Type.String({ description: "UTF-8 text content to write." }),
      overwrite: Type.Optional(Type.Boolean({ description: "Required to replace an existing file." })),
    }),
    readOnly: false,
    approval: {
      required: true,
      defaultScope: "once",
      normalizeTarget: (args) => approvalTargetFor(sourceFolders, args.root, args.path),
      preview: (args) => ({
        title: args.overwrite ? `Overwrite ${args.path}` : `Create ${args.path}`,
        args: mutationPreviewSummary(args, "write"),
      }),
    },
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const target = await resolveMutationTarget(root, args.path);
      return withFileMutationQueue(target.canonicalKey, async () => {
        abortIfNeeded(signal);
        const current = await resolveMutationTarget(root, args.path);
        if (current.exists && args.overwrite !== true) throw new Error("Target file already exists; pass overwrite: true to replace it.");
        const before = current.exists ? textFromBuffer(await fs.readFile(current.absolutePath)) : "";
        abortIfNeeded(signal);
        await atomicReplaceUtf8(current.absolutePath, args.content, signal);
        const diff = boundedMutationDiffDetails(before, args.content, current.relativePath);
        const operation = current.exists ? "overwrite" : "create";
        const verb = operation === "create" ? "created" : "overwritten";
        return textResult(`Project file ${verb}: ${current.relativePath}`, {
          path: current.relativePath,
          operation,
          bytes: Buffer.byteLength(args.content, "utf-8"),
          diff: diff.text,
          truncation: truncation(diff.truncated ? "output" : undefined),
        });
      });
    },
  };

  const editFile: AgentTool<EditArgs, unknown> = {
    name: "project_edit_file",
    label: "Edit Project File",
    description: "Edit one existing UTF-8 Project file by exact oldText/newText replacement.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source folder. Defaults to the first." })),
      path: Type.String({ description: "Relative file path inside the selected source folder." }),
      oldText: Type.String({ description: "Exact text to replace. Must match once unless replaceAll is true." }),
      newText: Type.String({ description: "Replacement text." }),
      replaceAll: Type.Optional(Type.Boolean({ description: "Replace all matches instead of requiring exactly one." })),
    }),
    readOnly: false,
    approval: {
      required: true,
      defaultScope: "once",
      normalizeTarget: (args) => approvalTargetFor(sourceFolders, args.root, args.path),
      preview: (args) => ({
        title: `Edit ${args.path}`,
        args: mutationPreviewSummary(args, "edit"),
      }),
    },
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceFolders, args.root);
      const target = await resolveExistingFile(root, args.path);
      return withFileMutationQueue(target.canonicalKey, async () => {
        abortIfNeeded(signal);
        const current = await resolveExistingFile(root, args.path);
        const before = textFromBuffer(await fs.readFile(current.absolutePath));
        const edited = replaceExact(before, args.oldText, args.newText, args.replaceAll);
        abortIfNeeded(signal);
        await atomicReplaceUtf8(current.absolutePath, edited.content, signal);
        const diff = boundedMutationDiffDetails(before, edited.content, current.relativePath);
        return textResult(`Project file edited: ${current.relativePath} (${edited.replacements} replacement${edited.replacements === 1 ? "" : "s"})`, {
          path: current.relativePath,
          operation: "edit",
          replacements: edited.replacements,
          bytes: Buffer.byteLength(edited.content, "utf-8"),
          diff: diff.text,
          truncation: truncation(diff.truncated ? "output" : undefined),
        });
      });
    },
  };

  return [writeFile, editFile];
}
