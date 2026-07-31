import { describe, expect, it, vi } from "vitest";
import { createRuntimeSummarizer } from "./summarizationAdapter";

function streamResult(result: unknown) {
  return {
    async *[Symbol.asyncIterator]() {},
    result: async () => result,
  };
}

describe("createRuntimeSummarizer", () => {
  it("uses configured credentials, bounded output, abort signal, and returns exact usage when available", async () => {
    const signal = new AbortController().signal;
    const getApiKey = vi.fn(async () => "secret");
    const streamSummary = vi.fn(async () => streamResult({
        message: { role: "assistant", content: [{ type: "text", text: "Structured summary." }] },
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      }));
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ providerId: "openai", model: "gpt-summary", apiKey: getApiKey }),
      streamSummary,
      maxAttempts: 1,
    });

    const result = await summarizer.summarize(
      {
        systemPrompt: "Summarize with fixed sections.",
        previousCheckpointSummary: "old",
        transcript: { range: { fromSeq: 0, toSeq: 1 }, items: [], toolActivity: [], truncated: false },
      },
      { signal, maxOutputTokens: 512 },
    );

    expect(getApiKey).toHaveBeenCalledOnce();
    expect(streamSummary).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "openai", model: "gpt-summary" }),
      expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("old") })]),
      expect.objectContaining({ signal, maxOutputTokens: 512, apiKey: "secret" }),
    );
    expect(result).toEqual({
      summary: "Structured summary.",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, exact: true },
    });
  });

  it("retries a failed summary stream once under the configured retry policy", async () => {
    const streamSummary = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(streamResult({ text: "retry summary" }));
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ model: "gpt-summary" }),
      streamSummary,
      maxAttempts: 2,
    });

    await expect(summarizer.summarize({
      systemPrompt: "Summarize.",
      transcript: { range: { fromSeq: 0, toSeq: 0 }, items: [], toolActivity: [], truncated: false },
    }, { maxOutputTokens: 128 })).resolves.toMatchObject({ summary: "retry summary" });
    expect(streamSummary).toHaveBeenCalledTimes(2);
  });

  it("parses the direct AssistantMessage result returned by pi-ai streams", async () => {
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ model: "gpt-summary" }),
      streamSummary: vi.fn(async () => streamResult({
          role: "assistant",
          content: [{ type: "text", text: "Direct stream summary." }],
          usage: { totalTokens: 12 },
        })),
      maxAttempts: 1,
    });

    await expect(summarizer.summarize({
      systemPrompt: "Summarize.",
      transcript: { range: { fromSeq: 0, toSeq: 0 }, items: [], toolActivity: [], truncated: false },
    }, { maxOutputTokens: 128 })).resolves.toMatchObject({ summary: "Direct stream summary." });
  });

  it("throws model error messages instead of returning an empty summary", async () => {
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ model: "gpt-summary" }),
      streamSummary: vi.fn(async () => streamResult({
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "summary auth failed",
        })),
      maxAttempts: 1,
    });

    await expect(summarizer.summarize({
      systemPrompt: "Summarize.",
      transcript: { range: { fromSeq: 0, toSeq: 0 }, items: [], toolActivity: [], truncated: false },
    }, { maxOutputTokens: 128 })).rejects.toThrow("summary auth failed");
  });

  it("falls back to streamed text deltas when the final result has empty content", async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "streamed " };
        yield { type: "text_end", content: "summary" };
      },
      result: async () => ({ role: "assistant", content: [], stopReason: "stop" }),
    };
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ model: "gpt-summary" }),
      streamSummary: vi.fn(async () => stream),
      maxAttempts: 1,
    });

    await expect(summarizer.summarize({
      systemPrompt: "Summarize.",
      transcript: { range: { fromSeq: 0, toSeq: 0 }, items: [], toolActivity: [], truncated: false },
    }, { maxOutputTokens: 128 })).resolves.toMatchObject({ summary: "streamed summary" });
  });

  it("throws a diagnostic shape when the summary result is empty without an explicit model error", async () => {
    const summarizer = createRuntimeSummarizer({
      resolveModel: () => ({ model: "gpt-summary" }),
      streamSummary: vi.fn(async () => streamResult({ role: "assistant", content: [{ type: "thinking", thinking: "internal" }], stopReason: "length" })),
      maxAttempts: 1,
    });

    await expect(summarizer.summarize({
      systemPrompt: "Summarize.",
      transcript: { range: { fromSeq: 0, toSeq: 0 }, items: [], toolActivity: [], truncated: false },
    }, { maxOutputTokens: 128 })).rejects.toThrow("Summary model returned empty text");
  });
});
