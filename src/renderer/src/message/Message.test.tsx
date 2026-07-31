// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Message } from "./Message";
import "./message.css";

afterEach(() => cleanup());

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
