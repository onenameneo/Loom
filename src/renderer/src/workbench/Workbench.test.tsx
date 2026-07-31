// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "./Workbench";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as any).api;
});

describe("Workbench", () => {
  it("returns focus to the add control when its menu closes with Escape", () => {
    (window as any).api = { canvas: { trace: vi.fn(async () => ({ records: [] })), onTrace: vi.fn(() => () => {}) } };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const add = screen.getByRole("button", { name: "打开页面" });
    fireEvent.click(add);
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("summarizes model duration and usage before a trace row is expanded", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed", startedAt: 1_000, endedAt: 2_500,
            entries: [
              { sequence: 1, kind: "request", payload: { model: { provider: "openai", id: "gpt-5" }, systemPrompt: { text: "long prompt", truncated: true } } },
              { sequence: 2, kind: "response", payload: { message: { usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } } } },
            ],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    expect(await screen.findByText("openai/gpt-5 · 1.5s · in 30 · out 12 · total 42 tokens")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === "long prompt\n[TRUNCATED]")).toBeTruthy();
  });

  it("shows response usage fields directly with common provider aliases", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed",
            entries: [{
              sequence: 1,
              kind: "response",
              payload: {
                message: {
                  role: "assistant",
                  content: "answer",
                  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 80, reasoningTokens: 5 },
                },
              },
            }],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    expect(await screen.findByText("Response usage")).toBeTruthy();
    expect(screen.getByText("100 tokens")).toBeTruthy();
    expect(screen.getByText("20 tokens")).toBeTruthy();
    expect(screen.getByText("120 tokens")).toBeTruthy();
    expect(screen.getByText("80 tokens")).toBeTruthy();
    expect(screen.getByText("5 tokens")).toBeTruthy();
  });

  it("renders summarized request messages from the trace preview payload", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed",
            entries: [{
              sequence: 1,
              kind: "request",
              payload: {
                model: { provider: "p", id: "m" },
                messages: [{ role: "user", text: "checkpoint summary preview", contentParts: ["text"] }],
                tools: [],
              },
            }],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    expect(await screen.findByText((_, element) => element?.tagName === "PRE" && element.textContent === "checkpoint summary preview")).toBeTruthy();
  });

  it("opens Trace from the empty horizontal chooser and returns to it after close", () => {
    render(<Workbench nodeId={null} />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Trace/ }));
    expect(screen.getByRole("tab", { name: /Trace/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭 Trace" }));
    expect(screen.getByRole("menu", { name: "打开工作台页面" })).toBeTruthy();
  });

  it("renders the add menu in the overlay root", () => {
    const overlay = document.createElement("div");
    overlay.id = "app-overlay-root";
    document.body.append(overlay);
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "打开页面" }));
    expect(overlay.contains(screen.getByRole("menu"))).toBe(true);
    overlay.remove();
  });

  it("keeps a new live update non-disruptive while the reader is in history", async () => {
    let emitTrace: ((snapshot: unknown) => void) | undefined;
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", sequence: 1, records: [] })),
        onTrace: vi.fn((listener) => { emitTrace = listener; return () => {}; }),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);
    const inspector = screen.getByRole("tabpanel", { name: "Trace" });
    Object.defineProperty(inspector, "scrollTop", { configurable: true, value: 80 });
    fireEvent.scroll(inspector);

    emitTrace?.({ nodeId: "node-1", sequence: 2, records: [] });
    expect(await screen.findByRole("button", { name: "有新的 Trace 活动" })).toBeTruthy();
  });

  it("allows an LLM response body to be collapsed", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed",
            entries: [{ sequence: 1, kind: "response", payload: { message: { role: "assistant", content: "long response" } } }],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const response = await screen.findByText("LLM Response 1");
    const responseDetails = response.closest("details");

    expect(responseDetails).toBeTruthy();
    expect(responseDetails).toHaveProperty("open", true);
    fireEvent.click(response);
    expect(responseDetails).toHaveProperty("open", false);
  });

  it("renders trace entries in chronological order and labels assistant tool calls", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed",
            entries: [
              { sequence: 1, kind: "request", payload: { model: { provider: "p", id: "m" }, messages: [], tools: [] } },
              { sequence: 2, kind: "response", payload: { message: { role: "assistant", content: [{ type: "toolCall", id: "call-now", name: "now", arguments: {} }] } } },
              { sequence: 3, kind: "tool", payload: { state: "start", name: "now", id: "call-now", arguments: {} } },
              { sequence: 4, kind: "tool", payload: { state: "end", name: "now", id: "call-now", arguments: {}, result: [{ type: "text", text: "2026-07-29" }] } },
              { sequence: 5, kind: "request", payload: { model: { provider: "p", id: "m" }, messages: [], tools: [] } },
              { sequence: 6, kind: "response", payload: { message: { role: "assistant", content: "final answer" } } },
            ],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "LLM Request 1",
      "LLM Tool Decision 1",
      "Tool now",
      "Tool now",
      "LLM Request 2",
      "LLM Response 2",
    ]);
    expect(screen.getByText("call-now")).toBeTruthy();
  });

  it("renders compaction lifecycle trace entries with bounded diagnostics", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", sequence: 1,
          records: [{
            turnId: "turn-1", operation: "send", state: "completed",
            entries: [
              { sequence: 1, kind: "request", payload: { model: { provider: "openai", id: "gpt-5" }, messages: [] } },
              { sequence: 2, kind: "event", payload: { state: "planned", trigger: "threshold", kind: "retain-tail", compactThroughSeq: 4, retainedFromSeq: 5, retainedTokenCount: 100 } },
              {
                sequence: 3,
                kind: "event",
                payload: {
                  state: "succeeded",
                  trigger: "threshold",
                  checkpointId: "cp-1",
                  coverage: { fromSeq: 0, toSeq: 4 },
                  retainedTail: { fromSeq: 5, toSeq: 7 },
                  diagnostics: { before: { tokens: 1200, exact: false }, after: { tokens: 320, exact: true } },
                  summaryUsage: { totalTokens: 90, exact: false },
                },
              },
              { sequence: 4, kind: "response", payload: { message: { role: "assistant", content: "done" } } },
            ],
          }],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    expect(await screen.findByText("Compaction planned")).toBeTruthy();
    expect(screen.getByText("threshold · retain-tail")).toBeTruthy();
    expect(screen.getByText("Compaction succeeded")).toBeTruthy();
    expect(screen.getByText("coverage 0..4")).toBeTruthy();
    expect(screen.getByText("estimated before: 1200 tokens")).toBeTruthy();
    expect(screen.getByText("exact after: 320 tokens")).toBeTruthy();
    expect(screen.getByText("estimated summary: 90 tokens")).toBeTruthy();
    expect((await screen.findAllByRole("heading", { level: 3 })).map((heading) => heading.textContent)).toEqual([
      "LLM Request 1",
      "Compaction planned",
      "Compaction succeeded",
      "LLM Response 1",
    ]);
    expect(screen.queryByText(/Transcript:/)).toBeNull();
  });
});
