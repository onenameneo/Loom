// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Message } from "./Message";
import "./message.css";
import type { LiveTurnContentPart } from "../../../common/liveTurns";
import type { SelectionContextNote } from "../../../common/selectionContext";

const messageStyles = readFileSync("src/renderer/src/message/message.css", "utf8");

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

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

  it("keeps message actions in the message flow instead of overlaying the next timeline item", () => {
    expect(messageStyles).not.toMatch(/\.m__bar\s*\{[^}]*position:\s*absolute;/);
    expect(messageStyles).not.toMatch(/\.m__bar\s*\{[^}]*display:\s*none;/);
    expect(messageStyles).toMatch(/\.m__bar\s*\{[^}]*opacity:\s*0;/);
    expect(messageStyles).toMatch(/\.m__bar\s*\{[^}]*transition:[^;]*(opacity|transform)/);

    const { container } = render(
      <Message role="assistant" text="Final answer" thinking="Internal notes" />,
    );
    const content = container.querySelector(".m__md");
    const actions = container.querySelector(".m__bar");
    expect(content && actions && Boolean(content.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("does not expose actions for an assistant message that only contains thinking", () => {
    const { container } = render(
      <Message role="assistant" text="" thinking="Internal notes" />,
    );

    expect(container.querySelector(".m__thinking")).toBeTruthy();
    expect(container.querySelector(".m__bar")).toBeNull();
  });

  it("renders ordered live content parts without moving later thinking before text", () => {
    const parts: LiveTurnContentPart[] = [
      { partId: "text-1", kind: "text", text: "First answer", sequence: 1 },
      { partId: "thinking-2", kind: "thinking", text: "Later check", sequence: 2 },
    ];
    const { container } = render(<Message role="assistant" text="First answer" thinking="Later check" contentParts={parts} />);
    const answer = screen.getByText("First answer");
    const thinking = container.querySelector(".m__thinking");
    expect(answer.compareDocumentPosition(thinking as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe("Message edit mode", () => {
  it("keeps the editor as one field with actions anchored in its lower-right corner", () => {
    const onEditResend = vi.fn();
    const { container } = render(
      <Message role="user" text="Original question" canEdit onEditResend={onEditResend} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑重发" }));

    const editor = container.querySelector(".m__edit");
    const textarea = screen.getByRole("textbox");
    const actions = container.querySelector(".m__edit-actions");
    expect(container.querySelector(".m--editing")).toBeTruthy();
    expect(editor?.className).toContain("rounded-loom-md");
    expect(editor?.className).toContain("bg-loom-surface-2");
    expect(container.querySelector(".m__edit-label")).toBeNull();
    expect(editor?.contains(textarea)).toBe(true);
    expect(editor?.contains(actions)).toBe(true);
    expect(container.querySelector(".m__bar")).toBeNull();
    expect(screen.getByRole("button", { name: "取消" }).className).toContain("border-loom-border-strong");
    expect(screen.getByRole("button", { name: "重发" }).className).toContain("bg-loom-accent");
  });

  it("resends from the documented keyboard shortcut", () => {
    const onEditResend = vi.fn();
    render(<Message role="user" text="Original question" canEdit onEditResend={onEditResend} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑重发" }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Updated question" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onEditResend).toHaveBeenCalledWith("Updated question");
  });
});

describe("Message file references", () => {
  it("keeps HTTP links on the external browser path", () => {
    render(<Message role="assistant" text="[OpenAI](https://openai.com)" />);

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link.getAttribute("href")).toBe("https://openai.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("leaves unregistered filenames as selectable assistant text", () => {
    render(<Message role="assistant" text="missing-report.pdf" />);

    expect(screen.queryByRole("link", { name: "missing-report.pdf" })).toBeNull();
    expect(screen.getByText("missing-report.pdf")).toBeTruthy();
  });

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

  it("opens a registered generated file when its filename link is clicked", async () => {
    const action = vi.fn(async () => ({ ok: true }));
    window.api = { artifacts: { action } } as any;
    render(
      <Message
        role="assistant"
        text="已创建 hello-world.docx。"
        artifacts={[{
          id: "artifact_12345678",
          name: "hello-world.docx",
          displayPath: "/tmp/hello-world.docx",
          kind: "document",
          operation: "created",
          status: "available",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "hello-world.docx" }));
    await act(async () => undefined);
    expect(action).toHaveBeenCalledWith({ id: "artifact_12345678", action: "open" });
    expect(screen.getByRole("link", { name: "hello-world.docx" }).className).toContain("nodrag");
    expect(screen.getByLabelText("Generated files").className).toContain("nodrag");
  });

  it("groups generated files into one aggregate panel", () => {
    const artifacts = ["title.html", "card.html", "build.js", "hello-world-test.pptx"].map((name, index) => ({
      id: `artifact_${index}`,
      name,
      displayPath: `pptx-test/${name}`,
      kind: "document" as const,
      operation: "created" as const,
      status: "available" as const,
    }));
    const { container } = render(<Message role="assistant" text="已完成文件生成。" artifacts={artifacts} />);

    expect(container.querySelectorAll(".m__artifacts")).toHaveLength(1);
    expect(container.querySelectorAll(".m__artifact")).toHaveLength(4);
    expect(screen.getByLabelText("Generated files")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview file in Loom" })).toBeNull();
  });

  it("collapses long generated file lists and expands them on demand", () => {
    const artifacts = Array.from({ length: 7 }, (_, index) => ({
      id: `artifact_${index}`,
      name: `file-${index}.txt`,
      displayPath: `output/file-${index}.txt`,
      kind: "text" as const,
      operation: "created" as const,
      status: "available" as const,
    }));
    const { container } = render(<Message role="assistant" text="已完成文件生成。" artifacts={artifacts} />);

    expect(container.querySelectorAll(".m__artifact:not([hidden])")).toHaveLength(5);
    const toggle = screen.getByRole("button", { name: "Expand generated files" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(container.querySelectorAll(".m__artifact:not([hidden])")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Collapse generated files" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a registered generated file when the assistant wraps its path in inline code", async () => {
    const action = vi.fn(async () => ({ ok: true }));
    window.api = { artifacts: { action } } as any;
    render(
      <Message
        role="assistant"
        text="文件：`pptx-test/hello-world-test.pptx`"
        artifacts={[{
          id: "artifact_12345678",
          name: "hello-world-test.pptx",
          displayPath: "pptx-test/hello-world-test.pptx",
          kind: "document",
          operation: "created",
          status: "available",
          project: { projectId: "project-1", root: "project:0", path: "pptx-test/hello-world-test.pptx" },
        }]}
      />,
    );

    const link = screen.getByRole("link", { name: "pptx-test/hello-world-test.pptx" });
    fireEvent.click(link);
    await act(async () => undefined);
    expect(action).toHaveBeenCalledWith({ id: "artifact_12345678", action: "open" });
  });

  it("copies the canonical display path from the secondary action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.api = { artifacts: { action: vi.fn(async () => ({ ok: true })) } } as any;
    render(
      <Message
        role="assistant"
        text="已创建 report.pdf。"
        artifacts={[{
          id: "artifact_12345678",
          name: "report.pdf",
          displayPath: "/tmp/report.pdf",
          kind: "document",
          operation: "created",
          status: "available",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith("/tmp/report.pdf");
  });
});

describe("Message selection notes", () => {
  it("shows selected text and its annotation when sent without a typed prompt", () => {
    const notes: SelectionContextNote[] = [{ id: "note-1", text: "被选中的原文", annotation: "重点关注这个定义" }];

    const { container } = render(<Message role="user" text="" selectionNotes={notes} />);

    expect(screen.getByText("被选中的原文")).toBeTruthy();
    expect(screen.getByText("重点关注这个定义")).toBeTruthy();
    expect(container.querySelector(".m__selection-notes")).toBeTruthy();
  });
});
