// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerBudget } from "./useComposerBudget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe({ text }: { text: string }) {
  const { budget } = useComposerBudget("n1", { text });
  return <output>{budget?.projectedInputTokens ?? "pending"}</output>;
}

describe("useComposerBudget", () => {
  it("debounces preview requests and ignores an older response", async () => {
    let resolveFirst!: (value: any) => void;
    let resolveSecond!: (value: any) => void;
    const budget = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    window.api = { canvas: { budget } } as any;

    const { rerender } = render(<Probe text="first" />);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    rerender(<Probe text="second" />);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(budget).toHaveBeenCalledTimes(2);

    resolveFirst({ projectedInputTokens: 1, safeInputBudget: 100, status: "ok", source: "estimated" });
    resolveSecond({ projectedInputTokens: 2, safeInputBudget: 100, status: "ok", source: "estimated" });
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
    expect(screen.queryByText("1")).toBeNull();
  });
});
