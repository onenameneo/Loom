import { promises as fs } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { Type } from "typebox";
import type { AgentTool, ReadonlyAgentTool } from "../../core/tool";
import { textResult } from "../../core/tool";
import type { PermissionRequest, SandboxMode } from "../../core/permissions";
import type { MemoryFileAccess, MemoryRootId } from "../../../memory/fileAccess";
import {
  DEFAULT_MAX_ENTRIES,
  MAX_MUTATION_DIFF_INPUT_BYTES,
  MAX_ENTRIES,
  MAX_LINES,
  MAX_OUTPUT_CHARS,
  abortIfNeeded,
  atomicReplaceUtf8,
  boundedMutationDiffDetails,
  appendBounded,
  boundedInteger,
  canonicalApprovalTarget,
  canonicalExternalApprovalTarget,
  fileVersion,
  findProjectRootForAbsolute,
  readBoundedUtf8,
  relativeProjectPath,
  resolveExternalExistingFile,
  resolveExternalMutationTarget,
  resolveExistingFile,
  resolveInside,
  resolveMutationTarget,
  selectProjectRoot,
  withFileMutationQueue,
  type ExternalFileTarget,
  type ProjectFileTarget,
} from "./access";
import { walkProjectFiles } from "./walker";
import {
  DEFAULT_READ_LIMIT,
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_READ_MAX_LINE_LENGTH,
  readTextWindow,
} from "./readWindow";

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

function textFromBuffer(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function modelVisibleVersion(version: string): string {
  return `[File version: ${version}]`;
}

function truncation(reason?: string, nextOffset?: number) {
  return {
    truncated: Boolean(reason),
    reason,
    ...(nextOffset === undefined ? {} : { nextOffset }),
  };
}

export interface ProjectFileToolOptions {
  memory?: MemoryFileAccess;
  getSandboxMode?: () => SandboxMode;
  getWritableRoots?: () => string[];
}

function isMemoryRoot(root: string | undefined): root is MemoryRootId {
  return root === "memory:user" || root === "memory:project" || root === "memory:candidates" || root === "memory:archive";
}

function isFullAccess(options: ProjectFileToolOptions): boolean {
  return options.getSandboxMode?.() === "danger-full-access";
}

function isWithinRoot(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function canAccessExternal(target: string, options: ProjectFileToolOptions): boolean {
  return isFullAccess(options) || (options.getWritableRoots?.() ?? []).some((root) => isWithinRoot(root, target));
}

function externalPathPermissionError(operation: "read" | "write" | "edit"): Error {
  return new Error(`Path is outside this Project's configured roots; cannot ${operation} an external absolute path unless danger-full-access is active.`);
}

type FileTarget = ProjectFileTarget | ExternalFileTarget;

async function resolveReadTarget(
  sourceRoots: string[],
  rootArg: string | undefined,
  pathArg: string,
  options: ProjectFileToolOptions,
): Promise<{ kind: "project"; target: ProjectFileTarget } | { kind: "external"; target: ExternalFileTarget }> {
  if (!rootArg && isAbsolute(pathArg)) {
    const projectRoot = await findProjectRootForAbsolute(sourceRoots, pathArg);
    if (projectRoot) return { kind: "project", target: await resolveExistingFile(projectRoot, pathArg) };
    if (!canAccessExternal(pathArg, options)) throw externalPathPermissionError("read");
    return { kind: "external", target: await resolveExternalExistingFile(pathArg) };
  }
  const root = await selectProjectRoot(sourceRoots, rootArg);
  return { kind: "project", target: await resolveExistingFile(root, pathArg) };
}

async function resolveMutationTargetForTool(
  sourceRoots: string[],
  rootArg: string | undefined,
  pathArg: string,
  operation: "write" | "edit",
  options: ProjectFileToolOptions,
): Promise<FileTarget> {
  if (!rootArg && isAbsolute(pathArg)) {
    const projectRoot = await findProjectRootForAbsolute(sourceRoots, pathArg);
    if (projectRoot) return resolveMutationTarget(projectRoot, pathArg);
    if (!canAccessExternal(pathArg, options)) throw externalPathPermissionError(operation);
    return resolveExternalMutationTarget(pathArg);
  }
  const root = await selectProjectRoot(sourceRoots, rootArg);
  return resolveMutationTarget(root, pathArg);
}

async function resolveExistingMutationTargetForTool(
  sourceRoots: string[],
  rootArg: string | undefined,
  pathArg: string,
  operation: "edit",
  options: ProjectFileToolOptions,
): Promise<FileTarget> {
  if (!rootArg && isAbsolute(pathArg)) {
    const projectRoot = await findProjectRootForAbsolute(sourceRoots, pathArg);
    if (projectRoot) return resolveExistingFile(projectRoot, pathArg);
    if (!canAccessExternal(pathArg, options)) throw externalPathPermissionError(operation);
    return resolveExternalExistingFile(pathArg);
  }
  const root = await selectProjectRoot(sourceRoots, rootArg);
  return resolveExistingFile(root, pathArg);
}

function targetPath(target: FileTarget): string {
  return target.kind === "external" ? target.absolutePath : target.relativePath;
}

function targetDetails(target: FileTarget): Record<string, unknown> {
  return target.kind === "external"
    ? { path: target.absolutePath, root: "external", external: true }
    : { path: target.relativePath };
}

export function createProjectFileTools(sourceRoots: string[], options: ProjectFileToolOptions = {}): ReadonlyAgentTool[] {
  if (sourceRoots.length === 0 && !options.memory && !isFullAccess(options) && (options.getWritableRoots?.().length ?? 0) === 0) return [];

  const listFiles: ReadonlyAgentTool<{ root?: string; path?: string; maxEntries?: number }, unknown> = {
    name: "project_list_files",
    label: "List Project Files",
    description: "List direct files and folders inside one source root of the current Loom Project.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source root. Defaults to the first." })),
      path: Type.Optional(Type.String({ description: "Relative directory path inside the selected source root." })),
      maxEntries: Type.Optional(Type.Number({ description: "Maximum entries to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceRoots, args.root);
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
    name: "read",
    label: "Read File",
    description: `Read a numbered UTF-8 text range from a Project, external absolute path, or logical memory root. The result includes a File version token; pass that exact token as expectedVersion when calling edit or overwriting an existing file. Use absolute paths for Project and external files; use an explicit memory root for memory-relative paths. In danger-full-access, an absolute path outside the current Project may be read as temporary external context. Project output is capped at ${DEFAULT_READ_LIMIT} lines, ${DEFAULT_READ_MAX_LINE_LENGTH} characters per line, or ${DEFAULT_READ_MAX_BYTES} bytes; use offset to continue large files.`,
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "project:0 or one of memory:user, memory:project, memory:candidates, memory:archive. Defaults to the current Project; omit for an absolute external path in danger-full-access." })),
      path: Type.String({ description: "Absolute path for Project or external files. A relative path is only valid with an explicit Project or memory root." }),
      offset: Type.Optional(Type.Number({ description: "1-based first line to return." })),
      limit: Type.Optional(Type.Number({ description: `Maximum lines to return, up to ${MAX_LINES}.` })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      if (isMemoryRoot(args.root)) {
        if (!options.memory) throw new Error("Memory tools are unavailable because long-term memory is disabled.");
        const result = await options.memory.read({ root: args.root, path: args.path, offset: args.offset, limit: args.limit });
        return textResult(
          [result.text, result.truncation.truncated ? `[Use offset=${result.truncation.nextOffset} to continue.]` : `[End of file - total ${result.totalLines} lines]`, modelVisibleVersion(result.version)].join("\n\n"),
          result,
        );
      }
      const resolved = await resolveReadTarget(sourceRoots, args.root, args.path, options);
      if (resolved.kind === "external") {
        const file = resolved.target.absolutePath;
        const stat = await fs.stat(file);
        const offset = boundedInteger(args.offset, 1, Number.MAX_SAFE_INTEGER);
        const limit = boundedInteger(args.limit, DEFAULT_READ_LIMIT, MAX_LINES);
        const window = await readTextWindow(file, {
          offset,
          limit,
          maxLineLength: DEFAULT_READ_MAX_LINE_LENGTH,
          maxBytes: DEFAULT_READ_MAX_BYTES,
          signal,
        });
        const lastLine = window.lastLine;
        const hasMore = window.truncatedByBytes || (lastLine !== undefined && lastLine < window.totalLines);
        const nextOffset = hasMore ? (lastLine ?? offset) + 1 : undefined;
        const footer = hasMore
          ? `[Showing external file lines ${offset}-${lastLine ?? offset - 1} of ${window.totalLines}${window.truncatedByBytes ? ` (${DEFAULT_READ_MAX_BYTES} byte limit)` : ""}. Use offset=${nextOffset} to continue.]`
          : `[End of external file - total ${window.totalLines} lines]`;
        const version = fileVersion(stat);
        const reason = window.truncatedByBytes ? "bytes" : hasMore ? "lines" : undefined;
        return textResult([window.lines.join("\n"), footer, modelVisibleVersion(version)].filter(Boolean).join("\n\n"), {
          ...targetDetails(resolved.target),
          offset,
          version,
          returnedLines: window.lines.length,
          totalLines: window.totalLines,
          truncation: truncation(reason, nextOffset),
        });
      }
      const file = resolved.target.absolutePath;
      const root = resolved.target.root;
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error("Path is not a file.");
      const offset = boundedInteger(args.offset, 1, Number.MAX_SAFE_INTEGER);
      const limit = boundedInteger(args.limit, DEFAULT_READ_LIMIT, MAX_LINES);
      const window = await readTextWindow(file, {
        offset,
        limit,
        maxLineLength: DEFAULT_READ_MAX_LINE_LENGTH,
        maxBytes: DEFAULT_READ_MAX_BYTES,
        signal,
      });
      const lastLine = window.lastLine;
      const hasMore = window.truncatedByBytes || (lastLine !== undefined && lastLine < window.totalLines);
      const nextOffset = hasMore ? (lastLine ?? offset) + 1 : undefined;
      const footer = hasMore
        ? `[Showing lines ${offset}-${lastLine ?? offset - 1} of ${window.totalLines}${window.truncatedByBytes ? ` (${DEFAULT_READ_MAX_BYTES} byte limit)` : ""}. Use offset=${nextOffset} to continue.]`
        : `[End of file - total ${window.totalLines} lines]`;
      const version = fileVersion(stat);
      const reason = window.truncatedByBytes ? "bytes" : hasMore ? "lines" : undefined;
      return textResult([window.lines.join("\n"), footer, modelVisibleVersion(version)].filter(Boolean).join("\n\n"), {
        path: relativeProjectPath(root, file),
        offset,
        version,
        returnedLines: window.lines.length,
        totalLines: window.totalLines,
        truncation: truncation(reason, nextOffset),
      });
    },
  };

  const findFiles: ReadonlyAgentTool<{ root?: string; path?: string; pattern: string; limit?: number }, unknown> = {
    name: "project_find_files",
    label: "Find Project Files",
    description: "Find files by glob pattern inside the current Loom Project source root.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "One configured Project source root. Defaults to the first." })),
      path: Type.Optional(Type.String({ description: "Relative directory or file path to search." })),
      pattern: Type.String({ description: "Glob pattern, for example src/**/*.ts." }),
      limit: Type.Optional(Type.Number({ description: "Maximum matching files to return." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      const root = await selectProjectRoot(sourceRoots, args.root);
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
      root: Type.Optional(Type.String({ description: "One configured Project source root. Defaults to the first." })),
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
      const root = await selectProjectRoot(sourceRoots, args.root);
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

  return [readFile, ...(sourceRoots.length > 0 ? [listFiles, findFiles, grep] : [])];
}

interface WriteArgs {
  root?: string;
  path: string;
  content: string;
  overwrite?: boolean;
  expectedVersion?: string;
}

interface EditArgs {
  root?: string;
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  expectedVersion?: string;
}

function mutationPreviewSummary(args: WriteArgs | EditArgs, kind: "write" | "edit") {
  if (kind === "write") {
    const writeArgs = args as WriteArgs;
    return {
      operation: writeArgs.overwrite ? "overwrite" : "create",
      path: writeArgs.path,
      expectedVersion: writeArgs.expectedVersion,
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
    expectedVersion: editArgs.expectedVersion,
  };
}

async function mutationPermissionRequest(
  sourceRoots: string[],
  root: string | undefined,
  path: string,
  options: ProjectFileToolOptions,
): Promise<PermissionRequest> {
  const normalizedTarget = await canonicalMutationTargetFor(sourceRoots, root, path, options);
  return {
    capability: "write",
    risk: "elevated",
    target: path,
    normalizedTarget,
    targetInWorkspace: !normalizedTarget.startsWith("external:") || canAccessExternal(path, options),
    workspaceRoots: sourceRoots,
  };
}

async function canonicalMutationTargetFor(
  sourceRoots: string[],
  rootArg: string | undefined,
  pathArg: string,
  options: ProjectFileToolOptions,
): Promise<string> {
  const memory = options.memory;
  if (isMemoryRoot(rootArg)) {
    if (!memory) throw new Error("Memory tools are unavailable because long-term memory is disabled.");
    return memory.resolveTarget(rootArg, pathArg);
  }
  if (!rootArg && isAbsolute(pathArg)) {
    const target = await resolveMutationTargetForTool(sourceRoots, rootArg, pathArg, "write", options);
    if (target.kind === "external") return canonicalExternalApprovalTarget(target.absolutePath);
    return canonicalApprovalTarget(target);
  }
  const target = await resolveMutationTargetForTool(sourceRoots, rootArg, pathArg, "write", options);
  if (target.kind === "external") return canonicalExternalApprovalTarget(target.absolutePath);
  return canonicalApprovalTarget(target);
}

function assertExpectedVersion(
  target: { version?: string },
  expectedVersion: string | undefined,
  operation: "write" | "edit",
  required = false,
): void {
  if (required && expectedVersion === undefined) {
    throw new Error(`Read the file first and pass expectedVersion before ${operation}.`);
  }
  if (expectedVersion === undefined || target.version === expectedVersion) return;
  throw new Error(`Target file changed since it was read; read it again before ${operation}.`);
}

async function assertCurrentExpectedVersion(
  targetPath: string,
  expectedVersion: string | undefined,
  operation: "write" | "edit",
): Promise<void> {
  if (expectedVersion === undefined) return;
  try {
    const stat = await fs.stat(targetPath);
    assertExpectedVersion({ version: fileVersion(stat) }, expectedVersion, operation);
  } catch (error) {
    if (error instanceof Error && error.message.includes("changed since it was read")) throw error;
    throw new Error(`Target file changed since it was read; read it again before ${operation}.`);
  }
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

export function createProjectMutationTools(sourceRoots: string[], options: ProjectFileToolOptions = {}): AgentTool[] {
  if (sourceRoots.length === 0 && !options.memory && !isFullAccess(options) && (options.getWritableRoots?.().length ?? 0) === 0) return [];

  const writeFile: AgentTool<WriteArgs, unknown> = {
    name: "write",
    label: "Write File",
    description: "Create or explicitly overwrite a UTF-8 text file inside a Project, external absolute path in danger-full-access, or logical memory root. Use absolute paths for Project and external files; read existing files first and pass expectedVersion.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "project:0 or one of memory:user, memory:project, memory:candidates. Omit for an absolute external path in danger-full-access." })),
      path: Type.String({ description: "Absolute path for Project or external files. A relative path is only valid with an explicit Project or memory root." }),
      content: Type.String({ description: "UTF-8 text content to write." }),
      overwrite: Type.Optional(Type.Boolean({ description: "Required to replace an existing file." })),
      expectedVersion: Type.Optional(Type.String({ description: "Version returned by read; rejects stale writes." })),
    }),
    readOnly: false,
    permission: {
      request: (args) => mutationPermissionRequest(sourceRoots, args.root, args.path, options),
      preview: (args) => ({
        title: args.overwrite ? `Overwrite ${args.path}` : `Create ${args.path}`,
        args: mutationPreviewSummary(args, "write"),
      }),
    },
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      if (isMemoryRoot(args.root)) {
        if (!options.memory) throw new Error("Memory tools are unavailable because long-term memory is disabled.");
        const result = await options.memory.write({ root: args.root, path: args.path, content: args.content, overwrite: args.overwrite, expectedVersion: args.expectedVersion });
        return textResult(`Memory file ${result.operation === "create" ? "created" : "overwritten"}: ${result.path}\n\n${modelVisibleVersion(result.version)}`, result);
      }
      const target = await resolveMutationTargetForTool(sourceRoots, args.root, args.path, "write", options);
      return withFileMutationQueue(target.canonicalKey, async () => {
        abortIfNeeded(signal);
        const current = await resolveMutationTargetForTool(sourceRoots, args.root, args.path, "write", options);
        if (current.exists && args.overwrite !== true) throw new Error("Target file already exists; pass overwrite: true to replace it.");
        assertExpectedVersion(current, args.expectedVersion, "write", current.exists);
        const before = current.exists ? await readBoundedUtf8(current.absolutePath, MAX_MUTATION_DIFF_INPUT_BYTES, signal) : "";
        abortIfNeeded(signal);
        await assertCurrentExpectedVersion(current.absolutePath, args.expectedVersion, "write");
        await atomicReplaceUtf8(current.absolutePath, args.content, signal);
        const diff = before === null
          ? { text: `[diff omitted: existing file exceeds ${MAX_MUTATION_DIFF_INPUT_BYTES} bytes or is unavailable]`, truncated: true }
          : boundedMutationDiffDetails(before, args.content, targetPath(current));
        const operation = current.exists ? "overwrite" : "create";
        const verb = operation === "create" ? "created" : "overwritten";
        const version = fileVersion(await fs.stat(current.absolutePath));
        const label = current.kind === "external" ? "External file" : "Project file";
        return textResult(`${label} ${verb}: ${targetPath(current)}\n\n${modelVisibleVersion(version)}`, {
          ...targetDetails(current),
          operation,
          version,
          bytes: Buffer.byteLength(args.content, "utf-8"),
          diff: diff.text,
          truncation: truncation(before === null ? "input" : diff.truncated ? "output" : undefined),
        });
      });
    },
  };

  const editFile: AgentTool<EditArgs, unknown> = {
    name: "edit",
    label: "Edit File",
    description: "Edit one existing UTF-8 Project, external absolute file in danger-full-access, or memory file by exact oldText/newText replacement. Read the file first and pass expectedVersion.",
    parameters: Type.Object({
      root: Type.Optional(Type.String({ description: "project:0 or one of memory:user, memory:project, memory:candidates. Omit for an absolute external path in danger-full-access." })),
      path: Type.String({ description: "Absolute path for Project or external files. A relative path is only valid with an explicit Project or memory root." }),
      oldText: Type.String({ description: "Exact text to replace. Must match once unless replaceAll is true." }),
      newText: Type.String({ description: "Replacement text." }),
      replaceAll: Type.Optional(Type.Boolean({ description: "Replace all matches instead of requiring exactly one." })),
      expectedVersion: Type.Optional(Type.String({ description: "Version returned by read; rejects stale edits." })),
    }),
    readOnly: false,
    permission: {
      request: (args) => mutationPermissionRequest(sourceRoots, args.root, args.path, options),
      preview: (args) => ({
        title: `Edit ${args.path}`,
        args: mutationPreviewSummary(args, "edit"),
      }),
    },
    execute: async ({ args, signal }) => {
      abortIfNeeded(signal);
      if (isMemoryRoot(args.root)) {
        if (!options.memory) throw new Error("Memory tools are unavailable because long-term memory is disabled.");
        const result = await options.memory.edit({ root: args.root, path: args.path, oldText: args.oldText, newText: args.newText, replaceAll: args.replaceAll, expectedVersion: args.expectedVersion });
        return textResult(`Memory file edited: ${result.path} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"})\n\n${modelVisibleVersion(result.version)}`, result);
      }
      const target = await resolveExistingMutationTargetForTool(sourceRoots, args.root, args.path, "edit", options);
      return withFileMutationQueue(target.canonicalKey, async () => {
        abortIfNeeded(signal);
        const current = await resolveExistingMutationTargetForTool(sourceRoots, args.root, args.path, "edit", options);
        assertExpectedVersion(current, args.expectedVersion, "edit", true);
        const stat = await fs.stat(current.absolutePath);
        if (stat.size >= MAX_MUTATION_DIFF_INPUT_BYTES) {
          throw new Error(`Edit target exceeds the ${MAX_MUTATION_DIFF_INPUT_BYTES} byte mutation input limit.`);
        }
        const before = textFromBuffer(await fs.readFile(current.absolutePath));
        const edited = replaceExact(before, args.oldText, args.newText, args.replaceAll);
        abortIfNeeded(signal);
        await assertCurrentExpectedVersion(current.absolutePath, args.expectedVersion, "edit");
        await atomicReplaceUtf8(current.absolutePath, edited.content, signal);
        const diff = Buffer.byteLength(before, "utf-8") >= MAX_MUTATION_DIFF_INPUT_BYTES || Buffer.byteLength(edited.content, "utf-8") >= MAX_MUTATION_DIFF_INPUT_BYTES
          ? { text: `[diff omitted: file content exceeds ${MAX_MUTATION_DIFF_INPUT_BYTES} bytes]`, truncated: true }
          : boundedMutationDiffDetails(before, edited.content, targetPath(current));
        const version = fileVersion(await fs.stat(current.absolutePath));
        const label = current.kind === "external" ? "External file" : "Project file";
        return textResult(`${label} edited: ${targetPath(current)} (${edited.replacements} replacement${edited.replacements === 1 ? "" : "s"})\n\n${modelVisibleVersion(version)}`, {
          ...targetDetails(current),
          operation: "edit",
          version,
          replacements: edited.replacements,
          bytes: Buffer.byteLength(edited.content, "utf-8"),
          diff: diff.text,
          truncation: truncation(
            Buffer.byteLength(before, "utf-8") >= MAX_MUTATION_DIFF_INPUT_BYTES || Buffer.byteLength(edited.content, "utf-8") >= MAX_MUTATION_DIFF_INPUT_BYTES
              ? "input"
              : diff.truncated ? "output" : undefined,
          ),
        });
      });
    },
  };

  return [writeFile, editFile];
}
