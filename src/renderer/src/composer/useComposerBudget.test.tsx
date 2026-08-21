// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerBudget } from "./useComposerBudget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe({ text, selectionNotes = [] }: { text: string; selectionNotes?: Array<{ id: string; text: string; annotation: string }> }) {
  const { budget } = useComposerBudget("n1", { text, selectionNotes });
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

  it("refreshes the preview when selection context changes", async () => {
    const budget = vi.fn(async () => ({ projectedInputTokens: 8, safeInputBudget: 100, status: "ok", source: "estimated" }));
    window.api = { canvas: { budget } } as any;
    const notes = [{ id: "note-1", text: "selected", annotation: "focus" }];

    const { rerender } = render(<Probe text="draft" selectionNotes={notes} />);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(budget).toHaveBeenLastCalledWith("n1", expect.objectContaining({ selectionNotes: notes }));

    rerender(<Probe text="draft" selectionNotes={[]} />);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(budget).toHaveBeenLastCalledWith("n1", expect.objectContaining({ selectionNotes: [] }));
  });
});
