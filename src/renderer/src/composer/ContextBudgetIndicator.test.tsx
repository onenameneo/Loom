// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextBudgetIndicator } from "./ContextBudgetIndicator";

afterEach(() => cleanup());

describe("ContextBudgetIndicator", () => {
  it("shows the real overflow percentage and budget details", () => {
    render(
      <ContextBudgetIndicator
        budget={{
          contextWindowTokens: 2_000,
          reserveOutputTokens: 500,
          safeInputBudget: 1_500,
          projectedInputTokens: 1_575,
          fixedContextTokens: 500,
          nodeLocalTailBudgetTokens: 1_000,
          overflowTokens: 75,
          status: "needs-compaction",
          source: "mixed",
          model: { providerId: "local", modelId: "test" },
        } as any}
        onCompact={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /105%/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /105%/ }));
    expect(screen.getByText(/预计输入/)).toBeTruthy();
    expect(screen.getByText(/mixed/)).toBeTruthy();
  });

  it("shows an unavailable state without offering compact", () => {
    render(<ContextBudgetIndicator budget={{ safeInputBudget: 0, status: "model-unavailable", diagnostic: "缺少窗口" } as any} onCompact={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /上下文不可用/ }));
    expect(screen.getByText("缺少窗口")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "压缩上下文" })).toBeNull();
  });

  it("offers one compact action for a budget that needs compaction", () => {
    const onCompact = vi.fn();
    render(
      <ContextBudgetIndicator
        budget={{ safeInputBudget: 1_000, projectedInputTokens: 900, status: "needs-compaction", source: "estimated" } as any}
        onCompact={onCompact}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /90%/ }));
    fireEvent.click(screen.getByRole("button", { name: "压缩上下文" }));
    expect(onCompact).toHaveBeenCalledTimes(1);
  });
});
