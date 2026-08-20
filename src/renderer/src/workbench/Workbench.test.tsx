// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "./Workbench";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  delete (window as any).api;
  delete (window as any).matchMedia;
});

describe("Workbench", () => {
  it("returns focus to the add control when its menu closes with Escape", () => {
    (window as any).api = { canvas: { trace: vi.fn(async () => ({ records: [] })), onTrace: vi.fn(() => () => {}) } };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const add = screen.getByRole("button", { name: "打开页面" });
    fireEvent(add, new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Trace" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Trace" }), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("closes the add menu when the pointer interacts outside its content", async () => {
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId={null} />);

    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent(screen.getByRole("button", { name: "打开页面" }), new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    fireEvent(outside, new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
    fireEvent.click(outside);
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(screen.queryByRole("menu")).toBeNull();
    outside.remove();
  });

  it("uses Radix tab state and keeps the tab close action pointer-friendly", () => {
    localStorage.setItem("loom:workbench:tabs", '["trace","files"]');
    render(<Workbench nodeId={null} />);

    const filesTab = screen.getByRole("tab", { name: /Files/ });
    const traceTab = screen.getByRole("tab", { name: /Trace/ });
    const filesTabShell = filesTab.parentElement!;
    const traceTabShell = traceTab.parentElement!;
    expect(traceTab.getAttribute("data-state")).toBe("active");
    expect(filesTab.getAttribute("data-state")).toBe("inactive");
    expect(traceTabShell.className).toContain("bg-loom-surface-2");
    expect(filesTabShell.className).toContain("bg-transparent");
    expect(filesTabShell.className).toContain("hover:bg-loom-surface-2");

    fireEvent.mouseDown(filesTab, { button: 0, ctrlKey: false });

    expect(filesTab.getAttribute("data-state")).toBe("active");
    expect(traceTab.getAttribute("data-state")).toBe("inactive");
    expect(screen.getByRole("button", { name: "关闭 Files" }).className).toContain("cursor-pointer");
  });

  function spanRecord(spans: any[], overrides: Record<string, unknown> = {}) {
    return { nodeId: "node-1", turnId: "turn-1", operation: "send", status: "ok", startedAt: 1_000, endedAt: 2_500, spans, ...overrides };
  }

  function turnSpan(startedAt = 1_000, endedAt = 2_500) {
    return { spanId: "turn", kind: "turn", name: "send", startedAt, endedAt, status: "ok", attributes: { operation: "send" } };
  }

  function llmSpan(overrides: Record<string, unknown> = {}, spanId = "llm") {
    return {
      spanId, parentSpanId: "turn", kind: "llm_call", name: "p/m", startedAt: 1_000, endedAt: 2_500, status: "ok",
      attributes: { model: { provider: "p", id: "m" }, messages: [], tools: [], ...overrides },
    };
  }

  async function openTurn(operation = "send") {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(operation) }));
  }

  it("summarizes model duration and usage before a trace row is expanded", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([
            turnSpan(),
            llmSpan({ model: { provider: "openai", id: "gpt-5" }, systemPrompt: { text: "long prompt", truncated: true }, usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } }),
          ])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const summary = await screen.findByRole("button", { name: /openai\/gpt-5/ });
    expect(summary.textContent).toContain("openai/gpt-5 · 1.5s · in 30 · out 12 · cache 0 · total 42 · estimated tokens");
    await openTurn();
    fireEvent.click(screen.getByRole("button", { name: /System prompt/ }));
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === "long prompt\n[TRUNCATED]")).toBeTruthy();
  });

  it("shows response usage fields directly with common provider aliases", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([
            turnSpan(),
            llmSpan({ usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 80, reasoningTokens: 5 } }),
          ])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    fireEvent.click(await screen.findByRole("button", { name: /Response usage/ }));
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
          nodeId: "node-1", revision: 1,
          records: [spanRecord([
            turnSpan(),
            llmSpan({ messages: [{ role: "user", text: "checkpoint summary preview", contentParts: ["text"] }] }),
          ])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    fireEvent.click(await screen.findByRole("button", { name: /Conversation/ }));
    expect(await screen.findByText((_, element) => element?.tagName === "PRE" && element.textContent === "checkpoint summary preview")).toBeTruthy();
  });

  it("opens Trace from the empty horizontal chooser and returns to it after close", () => {
    render(<Workbench nodeId={null} />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Trace/ }));
    expect(screen.getByRole("tab", { name: /Trace/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭 Trace" }));
    expect(screen.getByRole("menu", { name: "打开工作台页面" })).toBeTruthy();
  });

  it("registers Files as a persisted Workbench page and loads the active project directory", async () => {
    (window as any).api = {
      files: {
        list: vi.fn(async () => ({ projectId: "project-1", root: "project:0", path: ".", entries: [{ name: "src", path: "src", kind: "directory" }], truncated: false })),
        preview: vi.fn(),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["files"]');
    render(<Workbench nodeId={null} projectId="project-1" />);

    expect(screen.getByRole("tab", { name: /Files/ })).toBeTruthy();
    expect(await screen.findByRole("treeitem", { name: /src/ })).toBeTruthy();
    expect((window as any).api.files.list).toHaveBeenCalledWith({ projectId: "project-1", root: "project:0", path: undefined });
    expect(screen.getByRole("searchbox", { name: "搜索文件名" })).toBeTruthy();
    expect(screen.queryByLabelText("文件路径")).toBeNull();
    const collapse = screen.getByRole("button", { name: "折叠文件列表" });
    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "展开文件列表" })).toBeTruthy();
    expect(document.querySelector(".files-workspace")?.getAttribute("data-explorer-collapsed")).toBe("true");
  });

  it("keeps the file explorer splitter directly under pointer control during a drag", async () => {
    (window as any).api = {
      files: {
        list: vi.fn(async () => ({ projectId: "project-1", root: "project:0", path: ".", entries: [{ name: "src", path: "src", kind: "directory" }], truncated: false })),
        preview: vi.fn(),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["files"]');
    render(<Workbench nodeId={null} projectId="project-1" />);

    const splitter = await screen.findByRole("separator", { name: "调整文件列表宽度" });
    const workspace = document.querySelector<HTMLElement>(".files-workspace")!;
    Object.defineProperty(workspace, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1_000, height: 600, top: 0, left: 0, right: 1_000, bottom: 600 }),
    });

    fireEvent(splitter, new MouseEvent("pointerdown", { bubbles: true, clientX: 420 }));
    fireEvent(splitter, new MouseEvent("pointermove", { bubbles: true, clientX: 520 }));

    expect(workspace.classList.contains("is-resizing")).toBe(true);
    expect(workspace.style.getPropertyValue("--files-explorer-width")).toBe("52%");

    fireEvent(splitter, new MouseEvent("pointerup", { bubbles: true, clientX: 520 }));
    expect(workspace.classList.contains("is-resizing")).toBe(false);
    expect(splitter.getAttribute("aria-valuenow")).toBe("52");
  });

  it("renders the add menu in the overlay root", () => {
    const overlay = document.createElement("div");
    overlay.id = "app-overlay-root";
    document.body.append(overlay);
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId={null} />);

    fireEvent(screen.getByRole("button", { name: "打开页面" }), new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
    expect(overlay.contains(screen.getByRole("menu"))).toBe(true);
    overlay.remove();
  });

  it("keeps a new live update non-disruptive while the reader is in history", async () => {
    let emitTrace: ((event: unknown) => void) | undefined;
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [] })),
        onTrace: vi.fn((listener) => { emitTrace = listener; return () => {}; }),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);
    await act(async () => {});
    const inspector = screen.getByRole("tabpanel", { name: "Trace" });
    Object.defineProperty(inspector, "scrollTop", { configurable: true, value: 80 });
    fireEvent.scroll(inspector);

    emitTrace?.({
      type: "turn_start",
      nodeId: "node-1",
      turnId: "live-turn-1",
      operation: "live-send",
      revision: 2,
      startedAt: 3_000,
      span: { spanId: "live-root", kind: "turn", name: "live-send", startedAt: 3_000, status: "pending", attributes: {} },
    });
    expect(await screen.findByRole("button", { name: "有新的 Trace 活动" })).toBeTruthy();
    expect(screen.getByText("live-send")).toBeTruthy();
    expect(screen.getByText("live-turn-1")).toBeTruthy();
  });

  it("allows an LLM response body to be collapsed", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([turnSpan(), llmSpan({ messages: [{ role: "assistant", content: "long response" }] })])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    const conversation = await screen.findByRole("button", { name: /Conversation/ });

    expect(conversation.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(conversation);
    expect(conversation.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(conversation);
    expect(conversation.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a completed LLM response from end attributes in its own copyable reading disclosure", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([turnSpan(), llmSpan({
            messages: [{ role: "user", text: "request only" }],
            response: { text: "completed assistant answer", truncated: false },
          })])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    const response = screen.getByRole("button", { name: /Response/ });
    expect(response.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(response);
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === "completed assistant answer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制响应" })).toBeTruthy();
    expect(screen.queryByText("completed assistant answer")?.closest(".trace-message")).toBeNull();
  });

  it("stages an opening disclosure across two frames before its 200ms entry transition", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([turnSpan(), llmSpan({ systemPrompt: "private instructions" })]) ] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    frames.splice(0);
    const prompt = screen.getByRole("button", { name: /System prompt/ });
    const disclosure = prompt.closest(".trace-disclosure")!;
    fireEvent.click(prompt);
    expect(disclosure.getAttribute("data-phase")).toBe("opening");
    expect(document.getElementById(prompt.getAttribute("aria-controls")!)?.hasAttribute("inert")).toBe(false);
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(0));
    expect(disclosure.getAttribute("data-phase")).toBe("opening");
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(16));
    expect(disclosure.getAttribute("data-phase")).toBe("open");
  });

  it("keeps nested trace diagnostics collapsed and removes them from focus after close", async () => {
    vi.useFakeTimers();
    try {
      (window as any).api = {
        canvas: {
          trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([
            turnSpan(), llmSpan({ systemPrompt: "private instructions" }),
          ])] })),
          onTrace: vi.fn(() => () => {}),
        },
      };
      localStorage.setItem("loom:workbench:tabs", '["trace"]');
      render(<Workbench nodeId="node-1" />);
      await act(async () => {});
      fireEvent.click(screen.getByText("send"));
      const prompt = screen.getByRole("button", { name: /System prompt/ });
      const promptBody = () => document.getElementById(prompt.getAttribute("aria-controls")!)!;
      expect(prompt.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByText("已注入")).toBeTruthy();
      fireEvent.click(prompt);
      expect(prompt.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(prompt);
      expect(prompt.getAttribute("aria-expanded")).toBe("false");
      expect(promptBody().hasAttribute("inert")).toBe(true);
      act(() => vi.advanceTimersByTime(220));
      expect(promptBody().hasAttribute("hidden")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives duplicate LLM disclosure labels unique body ids", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([
          turnSpan(),
          llmSpan({ systemPrompt: "first instructions" }, "llm-first"),
          llmSpan({ systemPrompt: "second instructions" }, "llm-second"),
        ])] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    const prompts = await screen.findAllByRole("button", { name: /System prompt/ });
    const bodyIds = prompts.map((prompt) => prompt.getAttribute("aria-controls"));
    expect(new Set(bodyIds).size).toBe(2);
    bodyIds.forEach((bodyId) => expect(document.getElementById(bodyId!)).toBeTruthy());
  });

  it("namespaces disclosure body ids by trace record and span", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [
          spanRecord([turnSpan(), llmSpan({ systemPrompt: "first instructions" }, "shared-llm")]),
          spanRecord([turnSpan(), llmSpan({ systemPrompt: "second instructions" }, "shared-llm")], { turnId: "turn-2" }),
        ] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    const turnSummaries = await screen.findAllByRole("button", { name: /send/ });
    turnSummaries.forEach((summary) => fireEvent.click(summary));
    const prompts = await screen.findAllByRole("button", { name: /System prompt/ });
    const bodyIds = prompts.map((prompt) => prompt.getAttribute("aria-controls"));
    expect(new Set(bodyIds).size).toBe(2);
    expect(bodyIds.every((bodyId) => document.getElementById(bodyId!) !== null)).toBe(true);
  });

  it("keeps turns in a stable controlled disclosure lifecycle", async () => {
    vi.useFakeTimers();
    try {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([turnSpan(), llmSpan()])] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);
    await act(async () => {});

    const summary = screen.getByText("send").closest("button")!;
    const record = summary.closest(".trace-record")!;
    const body = document.getElementById(summary.getAttribute("aria-controls")!)!;
    expect(record.tagName).toBe("SECTION");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(body.hasAttribute("hidden")).toBe(true);
    expect(body.hasAttribute("inert")).toBe(true);
    fireEvent.click(summary);
    expect(record.getAttribute("data-phase")).toBe("opening");
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(body.hasAttribute("hidden")).toBe(false);
    const conversation = screen.getByRole("button", { name: /Conversation/ });
    conversation.focus();
    expect(document.activeElement).toBe(conversation);
    fireEvent.click(summary);
    expect(document.activeElement).toBe(summary);
    expect(record.getAttribute("data-phase")).toBe("closing");
    expect(body.hasAttribute("inert")).toBe(true);
    act(() => vi.advanceTimersByTime(220));
    expect(record.getAttribute("data-phase")).toBe("closed");
    expect(body.hasAttribute("hidden")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders trace timeline events and reading messages", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([
          turnSpan(),
          llmSpan({ messages: [{ role: "user", text: "checkpoint summary preview", contentParts: ["text"] }] }, "llm-reading"),
          { spanId: "tool-reading", parentSpanId: "turn", kind: "tool", name: "now", startedAt: 1_100, endedAt: 1_200, status: "ok", attributes: {} },
        ])] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    expect((await screen.findByRole("heading", { name: "LLM Call" })).closest("section")?.classList.contains("trace-timeline-event")).toBe(true);
    expect(screen.getByText("Tool now").closest("section")?.classList.contains("trace-timeline-event")).toBe(true);
    expect(screen.getByText("checkpoint summary preview").closest("article")?.classList.contains("trace-message--reading")).toBe(true);
  });

  it("closes nested trace disclosures immediately when reduced motion is preferred", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [spanRecord([
          turnSpan(), llmSpan({ systemPrompt: "private instructions" }),
        ])] })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    const prompt = await screen.findByRole("button", { name: /System prompt/ });
    const body = () => document.getElementById(prompt.getAttribute("aria-controls")!)!;
    fireEvent.click(prompt);
    fireEvent.click(prompt);
    expect(body().hasAttribute("hidden")).toBe(true);
  });

  it("renders the span tree in order and labels tool calls", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([
            turnSpan(),
            llmSpan({}, "llm1"),
            { spanId: "tool1", parentSpanId: "llm1", kind: "tool", name: "now", startedAt: 1_100, endedAt: 1_200, status: "ok", attributes: { id: "call-now", arguments: {}, result: [{ type: "text", text: "2026-07-29" }] } },
            llmSpan({}, "llm2"),
          ])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    const headings = await screen.findAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["LLM Call", "Tool now", "LLM Call"]);
    expect(screen.getByText("call-now")).toBeTruthy();
    const toolEvent = screen.getByRole("heading", { name: "Tool now" }).closest("section")!;
    expect(toolEvent.querySelector(".trace-tool")).toBeNull();
    expect(Array.from(toolEvent.children).some((child) => child.classList.contains("trace-disclosure"))).toBe(true);
  });

  it("formats the usage summary with compact token units", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({ nodeId: "node-1", revision: 1, records: [] })),
        metrics: vi.fn(async () => ({
          turns: 3,
          llmRequests: 14,
          toolCalls: 29,
          compactions: 0,
          durationMs: 118_100,
          ttftMs: 14_900,
          ttftSamples: 14,
          outputTokensPerSecond: 90,
          usage: {
            input: 36_178,
            output: 5_041,
            totalTokens: 353_155,
            cost: { total: 0.0073 },
          },
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    expect(await screen.findByText("353.16K")).toBeTruthy();
    expect(screen.getByText("36.18K")).toBeTruthy();
    expect(screen.getByText("5.04K")).toBeTruthy();
    expect(screen.getByText("118.1s")).toBeTruthy();
    expect(screen.getByText("1.1")).toBeTruthy();
  });

  it("renders compaction span with bounded diagnostics", async () => {
    (window as any).api = {
      canvas: {
        trace: vi.fn(async () => ({
          nodeId: "node-1", revision: 1,
          records: [spanRecord([
            turnSpan(),
            llmSpan({ model: { provider: "openai", id: "gpt-5" } }),
            {
              spanId: "cp", parentSpanId: "turn", kind: "compaction", name: "compact:threshold", startedAt: 1_300, endedAt: 1_400, status: "ok",
              attributes: {
                state: "succeeded", trigger: "threshold", kind: "retain-tail", compactThroughSeq: 4, retainedFromSeq: 5, retainedTokenCount: 100,
                checkpointId: "cp-1", coverage: { fromSeq: 0, toSeq: 4 }, retainedTail: { fromSeq: 5, toSeq: 7 },
                diagnostics: { before: { tokens: 1200, exact: false }, after: { tokens: 320, exact: true } },
                summaryUsage: { totalTokens: 90, exact: false },
              },
            },
          ])],
        })),
        onTrace: vi.fn(() => () => {}),
      },
    };
    localStorage.setItem("loom:workbench:tabs", '["trace"]');
    render(<Workbench nodeId="node-1" />);

    await openTurn();
    expect(await screen.findByText("Compaction succeeded")).toBeTruthy();
    expect(screen.getByText(/threshold · retain-tail/)).toBeTruthy();
    expect(screen.getByText("coverage 0..4")).toBeTruthy();
    expect(screen.getByText("estimated before: 1.20K tokens")).toBeTruthy();
    expect(screen.getByText("exact after: 320 tokens")).toBeTruthy();
    expect(screen.getByText("estimated summary: 90 tokens")).toBeTruthy();
    expect((await screen.findAllByRole("heading", { level: 3 })).map((heading) => heading.textContent)).toEqual([
      "LLM Call",
      "Compaction succeeded",
    ]);
  });
});
