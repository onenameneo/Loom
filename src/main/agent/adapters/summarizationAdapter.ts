import type { Message } from "@earendil-works/pi-ai";
import type { CheckpointSummaryInput } from "../core/compaction";
import type { ContextModelMetadata } from "../core/budget";
import type { CompactionSummaryResult } from "../app/compactionService";

export interface RuntimeSummaryModel {
  providerId?: string;
  modelId?: string;
  model: unknown;
  apiKey?: () => Promise<string> | string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
}

export interface RuntimeSummarizerDeps {
  resolveModel?(selection?: ContextModelMetadata): RuntimeSummaryModel | Promise<RuntimeSummaryModel>;
  streamSummary(
    model: RuntimeSummaryModel,
    messages: Message[],
    options: { maxOutputTokens: number; signal?: AbortSignal; apiKey?: string },
  ): Promise<AsyncIterable<unknown> & { result(): Promise<unknown> }> | (AsyncIterable<unknown> & { result(): Promise<unknown> });
  maxAttempts?: number;
}

export interface RuntimeSummarizer {
  summarize(input: CheckpointSummaryInput, options: { signal?: AbortSignal; maxOutputTokens: number; model?: ContextModelMetadata }): Promise<CompactionSummaryResult>;
}

export function createRuntimeSummarizer(deps: RuntimeSummarizerDeps): RuntimeSummarizer {
  const maxAttempts = Math.max(1, Math.round(deps.maxAttempts ?? 2));

  return {
    async summarize(input, options) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (!deps.resolveModel) throw new Error("Summary model resolver is unavailable.");
          const model = await deps.resolveModel(options.model);
          const apiKey = model.apiKey ? await model.apiKey() : undefined;
          const stream = await deps.streamSummary(model, summaryMessages(input), {
            maxOutputTokens: options.maxOutputTokens,
            signal: options.signal,
            apiKey,
          });
          const streamedText = collectStreamText(stream);
          const result = await stream.result();
          return parseSummaryResult(result, await streamedText);
        } catch (error) {
          lastError = error;
          if (options.signal?.aborted || attempt >= maxAttempts) throw error;
        }
      }
      throw lastError;
    },
  };
}

function summaryMessages(input: CheckpointSummaryInput): Message[] {
  return [
    {
      role: "user",
      content: [
        input.systemPrompt,
        input.previousCheckpointSummary ? `Previous checkpoint:\n${input.previousCheckpointSummary}` : undefined,
        `Transcript:\n${JSON.stringify(input.transcript)}`,
      ].filter(Boolean).join("\n\n"),
      timestamp: 0,
    },
  ];
}

async function collectStreamText(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: string[] = [];
  for await (const event of stream) {
    const value = event as any;
    if (typeof value?.delta === "string" && (value.type === "text_delta" || value.type === "delta")) chunks.push(value.delta);
    else if (typeof value?.content === "string" && value.type === "text_end") chunks.push(value.content);
  }
  return chunks.join("");
}

function parseSummaryResult(result: unknown, streamedText = ""): CompactionSummaryResult {
  const value = result as any;
  if (typeof value?.errorMessage === "string" && value.errorMessage.trim()) throw new Error(value.errorMessage);
  if (value?.stopReason === "error") throw new Error("Summary model returned an error without a message.");
  const summary = textFromResult(value) || streamedText;
  if (!summary.trim()) throw new Error(`Summary model returned empty text (${summaryResultShape(value)}).`);
  const usage = value?.usage;
  return {
    summary,
    usage: usage
      ? {
          inputTokens: numberOrUndefined(usage.inputTokens),
          outputTokens: numberOrUndefined(usage.outputTokens),
          totalTokens: numberOrUndefined(usage.totalTokens),
          exact: true,
        }
      : undefined,
  };
}

function summaryResultShape(value: any): string {
  const content = value?.message?.content ?? value?.content;
  const contentTypes = Array.isArray(content)
    ? content.map((item) => typeof item === "object" && item ? String(item.type ?? "object") : typeof item).join(",")
    : typeof content;
  return [
    `role=${String(value?.role ?? value?.message?.role ?? "unknown")}`,
    `stopReason=${String(value?.stopReason ?? "unknown")}`,
    `content=${contentTypes || "empty"}`,
  ].join(" ");
}

function textFromResult(value: any): string {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.outputText === "string") return value.outputText;
  const content = value?.message?.content ?? value?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text ?? "";
        if (item?.type === "output_text") return item.text ?? "";
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .join("");
  }
  return "";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
