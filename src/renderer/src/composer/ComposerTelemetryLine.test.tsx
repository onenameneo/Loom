// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerTelemetryLine } from "./ComposerTelemetryLine";

afterEach(() => cleanup());

describe("ComposerTelemetryLine", () => {
  it("renders compact runtime metrics in the composer footer", () => {
    render(
      <ComposerTelemetryLine
        metrics={{
          turns: 1,
          llmRequests: 2,
          toolCalls: 0,
          compactions: 0,
          durationMs: 2_000,
          ttftMs: 2_000,
          ttftSamples: 2,
          outputTokensPerSecond: 145,
          usage: { input: 74_500, output: 2_000, cacheRead: 41_720, cacheWrite: 0, totalTokens: 118_220, exact: true, source: "provider" },
        }}
      />,
    );
    const line = screen.getByLabelText("当前节点累计运行指标");
    expect(line.textContent).toContain("首 token 平均 1.0s");
    expect(line.textContent).toContain("LLM 输出速率 145 tok/s");
    expect(line.textContent).toContain("缓存占比 36%");
    expect(line.textContent).toContain("输入累计 74.5K tok");
    expect(line.textContent).toContain("输出累计 2.0K tok");
    expect(line.getAttribute("title")).toContain("缓存占比 = 缓存读取");
  });

  it("marks token totals as estimated when the provider did not return exact usage", () => {
    render(
      <ComposerTelemetryLine
        metrics={{
          turns: 1,
          llmRequests: 1,
          toolCalls: 0,
          compactions: 0,
          durationMs: 500,
          ttftMs: 500,
          ttftSamples: 1,
          outputTokensPerSecond: 20,
          usage: { input: 1_000, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 1_200, exact: false, source: "estimated" },
        }}
      />,
    );
    const line = screen.getByLabelText("当前节点累计运行指标");
    expect(line.textContent).toContain("缓存占比 ~0%");
    expect(line.textContent).toContain("输入累计 ~1.0K tok");
  });

  it("does not divide TTFT by requests that have no first-token measurement", () => {
    render(
      <ComposerTelemetryLine
        metrics={{
          turns: 1,
          llmRequests: 2,
          toolCalls: 0,
          compactions: 0,
          durationMs: 500,
          ttftMs: 500,
          ttftSamples: 1,
          outputTokensPerSecond: 20,
          usage: { input: 1_000, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 1_200, exact: true, source: "provider" },
        }}
      />,
    );

    expect(screen.getByLabelText("当前节点累计运行指标").textContent).toContain("首 token 平均 0.5s");
  });
});
