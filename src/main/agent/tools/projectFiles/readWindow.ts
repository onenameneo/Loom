import { createReadStream } from "fs";
import { promises as fs } from "fs";

export const DEFAULT_READ_LIMIT = 2_000;
export const DEFAULT_READ_MAX_LINE_LENGTH = 2_000;
export const DEFAULT_READ_MAX_BYTES = 50 * 1024;
export const DEFAULT_READ_STREAM_MIN_BYTES = 10 * 1024 * 1024;

export interface ReadWindowOptions {
  offset: number;
  limit: number;
  maxLineLength?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface ReadWindowResult {
  lines: string[];
  totalLines: number;
  lastLine?: number;
  truncatedByBytes: boolean;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

function normalizeLine(line: string, maxLineLength: number): string {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  return normalized.length > maxLineLength
    ? `${normalized.slice(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)`
    : normalized;
}

function lineByteSize(line: string, currentLineCount: number): number {
  return Buffer.byteLength(line, "utf-8") + (currentLineCount > 0 ? 1 : 0);
}

export async function buildReadWindow(
  chunks: AsyncIterable<string> | Iterable<string>,
  options: ReadWindowOptions,
): Promise<ReadWindowResult> {
  const maxLineLength = options.maxLineLength ?? DEFAULT_READ_MAX_LINE_LENGTH;
  const maxBytes = options.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  const lines: string[] = [];
  let totalLines = 0;
  let outputBytes = 0;
  let truncatedByBytes = false;
  let lastReturnedLine: number | undefined;
  let lineBuffer = "";
  const lineBufferCap = maxLineLength + 1;

  const consumeLine = (rawLine: string) => {
    totalLines += 1;
    abortIfNeeded(options.signal);
    if (truncatedByBytes || totalLines < options.offset || lines.length >= options.limit) return;

    const line = normalizeLine(rawLine, maxLineLength);
    if (outputBytes + lineByteSize(line, lines.length) > maxBytes) {
      truncatedByBytes = true;
      return;
    }

    outputBytes += lineByteSize(line, lines.length);
    lines.push(`${String(totalLines).padStart(6, " ")} | ${line}`);
    lastReturnedLine = totalLines;
  };

  const appendToLineBuffer = (segment: string) => {
    if (lineBuffer.length >= lineBufferCap) return;
    lineBuffer += segment;
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap);
  };

  const flushLine = () => {
    consumeLine(lineBuffer);
    lineBuffer = "";
  };

  for await (const chunk of chunks) {
    abortIfNeeded(options.signal);
    let start = 0;
    let newline: number;
    while ((newline = chunk.indexOf("\n", start)) !== -1) {
      appendToLineBuffer(chunk.slice(start, newline));
      flushLine();
      start = newline + 1;
    }
    appendToLineBuffer(chunk.slice(start));
  }

  if (lineBuffer.length > 0) flushLine();
  abortIfNeeded(options.signal);

  if (options.offset > totalLines && !(totalLines === 0 && options.offset === 1)) {
    throw new Error(`offset ${options.offset} is out of range (${totalLines} lines)`);
  }

  return {
    lines,
    totalLines,
    lastLine: lastReturnedLine,
    truncatedByBytes,
  };
}

async function* decodedFileChunks(filePath: string, signal?: AbortSignal): AsyncIterable<string> {
  const stream = createReadStream(filePath, signal ? { signal } : undefined);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      abortIfNeeded(signal);
      yield decoder.decode(chunk, { stream: true });
    }
    yield decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Operation aborted");
    throw error;
  }
}

export async function readTextWindow(
  filePath: string,
  options: ReadWindowOptions,
  streamMinBytes = DEFAULT_READ_STREAM_MIN_BYTES,
): Promise<ReadWindowResult> {
  abortIfNeeded(options.signal);
  const stat = await fs.stat(filePath);
  abortIfNeeded(options.signal);
  const chunks = stat.size >= streamMinBytes
    ? decodedFileChunks(filePath, options.signal)
    : [new TextDecoder("utf-8", { fatal: true }).decode(
        await fs.readFile(filePath, options.signal ? { signal: options.signal } : undefined),
      )];
  return buildReadWindow(chunks, options);
}
