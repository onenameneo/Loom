// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNodeMetrics } from "./useNodeMetrics";

afterEach(() => {
  delete (window as any).api;
});

describe("useNodeMetrics", () => {
  it("loads the node totals and exposes an explicit refresh", async () => {
    const metrics = vi.fn()
      .mockResolvedValueOnce({ turns: 1, llmRequests: 1, toolCalls: 0, compactions: 0, durationMs: 10, ttftMs: 2, ttftSamples: 1, outputTokensPerSecond: 3 })
      .mockResolvedValueOnce({ turns: 2, llmRequests: 2, toolCalls: 1, compactions: 0, durationMs: 20, ttftMs: 4, ttftSamples: 2, outputTokensPerSecond: 5 });
    (window as any).api = { canvas: { metrics } };

    const { result } = renderHook(() => useNodeMetrics("n1"));
    await waitFor(() => expect(result.current.metrics?.turns).toBe(1));

    await act(async () => result.current.refresh());
    expect(result.current.metrics?.turns).toBe(2);
    expect(metrics).toHaveBeenCalledTimes(2);
    expect(metrics).toHaveBeenLastCalledWith("n1");
  });
});
