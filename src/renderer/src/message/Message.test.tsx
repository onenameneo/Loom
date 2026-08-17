// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Message } from "./Message";
import "./message.css";

const messageStyles = readFileSync("src/renderer/src/message/message.css", "utf8");

afterEach(() => cleanup());

describe("Message thinking", () => {
  it("removes collapsed content from layout before recovering the width", () => {
    expect(messageStyles).not.toMatch(/\.m__thinking\.is-collapsed \.m__thinking-collapse\s*\{[^}]*transition:\s*none;/);
    expect(messageStyles).not.toMatch(/\.m__thinking\.is-collapsed\s*\{[^}]*transition:\s*none;/);
    expect(messageStyles).toMatch(/\.m__thinking\.is-collapsed \.m__thinking-body\s*\{[^}]*white-space:\s*nowrap;/);
  });

  it("renders assistant thinking as a collapsed animated section separate from the answer", () => {
    const { container } = render(
      <Message
        role="assistant"
        text="Final answer"
        thinking="I should inspect the code path first."
      />,
    );

    const thinking = container.querySelector(".m__thinking");
    const collapse = thinking?.querySelector(".m__thinking-collapse");
    expect(thinking?.classList.contains("is-open")).toBe(false);
    expect(thinking?.classList.contains("is-collapsed")).toBe(true);
    expect(collapse?.classList.contains("is-collapsed")).toBe(true);
    const toggle = screen.getByRole("button", { name: "Thinking" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(thinking?.classList.contains("is-open")).toBe(true);
    expect(collapse?.classList.contains("is-collapsed")).toBe(false);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Final answer")).toBeTruthy();
    expect(screen.getByText("I should inspect the code path first.")).toBeTruthy();
  });
});

describe("Message checkpoint timeline item", () => {
  it("renders checkpoint metadata as a default-collapsed timeline item", () => {
    const { container } = render(
      <Message
        role="checkpoint"
        text="## Goal\nRaw checkpoint summary should stay out of the collapsed timeline."
        checkpoint={{
          id: "cp-1",
          kind: "context",
          reason: "threshold",
          createdAt: 1_723_000_000_000,
          coverage: { fromSeq: 0, toSeq: 8 },
          retainedTail: { fromSeq: 9, toSeq: 12 },
          diagnostics: {
            before: { tokens: 14_000, exact: false },
            after: { tokens: 4_200, exact: true },
          },
          summaryUsage: { inputTokens: 800, outputTokens: 120, totalTokens: 920, exact: false },
        }}
      />,
    );

    const details = container.querySelector("details.m__checkpoint");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Context checkpoint")).toBeTruthy();
    expect(screen.getByText("threshold")).toBeTruthy();
    expect(screen.getByText("covers 0..8")).toBeTruthy();
    expect(screen.getByText("tail 9..12")).toBeTruthy();
    expect(screen.getByText("~14000 -> 4200 tokens")).toBeTruthy();
  });

  it("shows bounded summary and explicitly labels estimated budget details", () => {
    const longSummary = `## Goal\n${"summary ".repeat(700)}`;
    const { container } = render(
      <Message
        role="checkpoint"
        text={longSummary}
        checkpoint={{
          id: "cp-1",
          kind: "context",
          reason: "manual",
          createdAt: 1_723_000_000_000,
          coverage: { fromSeq: 2, toSeq: 18 },
          retainedTail: { fromSeq: 19, toSeq: 21 },
          diagnostics: {
            before: { tokens: 22_000, exact: false },
            after: { tokens: 5_100, exact: false },
          },
          summaryUsage: { inputTokens: 1_100, outputTokens: 300, totalTokens: 1_400, exact: false },
        }}
      />,
    );

    expect(container.querySelector("details.m__checkpoint")?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Projected context budget")).toBeTruthy();
    expect(screen.getByText("estimated before: 22000 tokens")).toBeTruthy();
    expect(screen.getByText("estimated after: 5100 tokens")).toBeTruthy();
    expect(screen.getByText("estimated summary request cost: 1400 tokens")).toBeTruthy();
    expect(screen.getByText(/\[summary truncated\]/)).toBeTruthy();
    expect(screen.queryByText(/User:/)).toBeNull();
  });
});

describe("Message branching", () => {
  it("does not offer branching from a user message", () => {
    render(<Message role="user" text="Question" sourceSeq={3} onBranch={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "分支" })).toBeNull();
  });

  it("offers the two branch destinations from the message action bar", () => {
    const onBranch = vi.fn();
    render(
      <Message
        role="assistant"
        text="A useful answer"
        sourceSeq={3}
        onBranch={onBranch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "分支" }));

    expect(screen.getByRole("dialog", { name: "从这里创建聊天分支" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "在当前窗口开启分支" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "在画布中开启分支" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "在画布中开启分支" }));
    expect(onBranch).toHaveBeenCalledWith("canvas-node", 3);
  });

  it("prevents duplicate branch requests while the first one is pending", async () => {
    let resolve: (() => void) | undefined;
    const onBranch = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<Message role="assistant" text="Answer" sourceSeq={1} onBranch={onBranch} />);

    fireEvent.click(screen.getByRole("button", { name: "分支" }));
    const option = screen.getByRole("button", { name: "在画布中开启分支" });
    fireEvent.click(option);
    fireEvent.click(option);
    expect(onBranch).toHaveBeenCalledOnce();
    expect((option as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolve?.());
  });
});

describe("Message file references", () => {
  it("shows the selected file and its project path on the sent message", () => {
    const { container } = render(
      <Message
        role="user"
        text="请总结这个文件"
        fileMentions={[{ root: "project:0", path: "src/common/titleDefaults.ts" }]}
      />,
    );

    expect(screen.getByText("@titleDefaults.ts")).toBeTruthy();
    expect(screen.getByText("src/common/titleDefaults.ts")).toBeTruthy();
    expect(container.querySelector(".m__file-mentions")).toBeTruthy();
  });
});
