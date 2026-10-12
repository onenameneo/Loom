// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { fullDraft, insertTextFragment } from "./pastedDraft";

const source = Array(14).fill("完整原文，包含足够多的行。").join("\n");

function Harness({ nodeId = "paste-node", onSubmit = vi.fn(), initialValue = "" }: { nodeId?: string; onSubmit?: ReturnType<typeof vi.fn>; initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => { setValue(initialValue); }, [nodeId, initialValue]);
  return <>
    <Composer nodeId={nodeId} value={value} onChange={setValue} busy={false} placeholder="Ask" canRegenerate={false}
      onSubmit={(...args) => { const result = onSubmit(...args); if (result) setValue(""); return result; }}
      onStop={vi.fn()} onOpenPersona={vi.fn()} onClearNode={vi.fn()} onRegenerate={vi.fn()} onSetModel={vi.fn()} onCompact={vi.fn()} />
    <output data-testid="canonical-draft">{value}</output>
  </>;
}

function paste(text = source) {
  fireEvent.paste(screen.getByPlaceholderText("Ask"), { clipboardData: { items: [], getData: () => text } });
}

afterEach(() => { cleanup(); localStorage.clear(); delete (window as any).api; });

describe("Composer pasted text", () => {
  it("renders a compact card and submits complete source in insertion order", () => {
    const onSubmit = vi.fn();
    render(<Harness initialValue="before after" onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Ask") as HTMLTextAreaElement;
    input.setSelectionRange(7, 7);
    paste();
    expect(input.value).toBe("before after");
    expect(screen.getByRole("button", { name: /文本片段 1.*字符/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(input, { target: { value: "before analyze" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit.mock.calls[0][0]).toBe(`before ${source}analyze`);
  });

  it("expands and edits a card without sending, and restores focus on close", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    paste();
    const toggle = screen.getByRole("button", { name: /文本片段 1.*字符/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const edit = screen.getByRole("button", { name: "编辑文本片段 1" });
    edit.focus();
    fireEvent.click(edit);
    const editor = screen.getByRole("textbox", { name: "编辑文本片段 1" });
    expect((editor as HTMLTextAreaElement).value).toBe(source);
    fireEvent.change(editor, { target: { value: `${source}\nupdated` } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(edit));
    fireEvent.keyDown(screen.getByPlaceholderText("Ask"), { key: "Enter" });
    expect(onSubmit.mock.calls[0][0]).toBe(`${source}\nupdated`);
  });

  it("undoes and redoes explicit removal without losing hidden text", () => {
    render(<Harness />);
    paste();
    fireEvent.click(screen.getByRole("button", { name: "移除文本片段 1" }));
    expect(screen.getByTestId("canonical-draft").textContent).toBe("");
    const input = screen.getByPlaceholderText("Ask");
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    expect(screen.getByTestId("canonical-draft").textContent).toBe(source);
    fireEvent.keyDown(input, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByTestId("canonical-draft").textContent).toBe("");
  });

  it("restores per-node cards even when the parent changes its draft in an effect", () => {
    const saved = insertTextFragment({ text: "instructions", fragments: [] }, 0, 0, source, "saved");
    localStorage.setItem("loom:pasted-draft:second", JSON.stringify({ version: 1, ...saved }));
    const { rerender } = render(<Harness nodeId="first" initialValue="first draft" />);
    rerender(<Harness nodeId="second" initialValue={fullDraft(saved)} />);
    expect((screen.getByPlaceholderText("Ask") as HTMLTextAreaElement).value).toBe("instructions");
    expect(screen.getByRole("button", { name: "编辑文本片段 1" })).toBeTruthy();
    rerender(<Harness nodeId="first" initialValue="first draft" />);
    expect((screen.getByPlaceholderText("Ask") as HTMLTextAreaElement).value).toBe("first draft");
  });

  it("restores cards and instructions after a failed optimistic submission", async () => {
    const onSubmit = vi.fn(async () => ({ ok: false }));
    render(<Harness onSubmit={onSubmit} />);
    paste();
    fireEvent.change(screen.getByPlaceholderText("Ask"), { target: { value: "analyze" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("canonical-draft").textContent).toBe(`${source}analyze`));
    expect(screen.getByRole("button", { name: "编辑文本片段 1" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Ask") as HTMLTextAreaElement).value).toBe("analyze");
  });

  it("leaves short paste to the normal textarea behavior", () => {
    render(<Harness />);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items: [], getData: () => "short" } });
    screen.getByPlaceholderText("Ask").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: "编辑文本片段 1" })).toBeNull();
  });

  it("recovers the full card when submission rejects", async () => {
    render(<Harness onSubmit={vi.fn(async () => { throw new Error("transport unavailable"); })} />);
    paste();
    fireEvent.keyDown(screen.getByPlaceholderText("Ask"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("canonical-draft").textContent).toBe(source));
    expect(screen.getByRole("button", { name: "编辑文本片段 1" })).toBeTruthy();
  });

  it("calculates the budget from full source and instructions", async () => {
    const budget = vi.fn(async () => ({ withoutAncestors: 0, withAncestors: 0, estimated: true }));
    (window as any).api = { canvas: { budget, models: vi.fn(async () => []) } };
    render(<Harness />);
    paste();
    fireEvent.change(screen.getByPlaceholderText("Ask"), { target: { value: "analyze" } });
    await waitFor(() => expect(budget).toHaveBeenLastCalledWith("paste-node", expect.objectContaining({ text: `${source}analyze` })));
  });

  it("preserves the visible draft selection through the larger editor", async () => {
    render(<Harness initialValue={"line one\nline two"} />);
    const input = screen.getByPlaceholderText("Ask") as HTMLTextAreaElement;
    input.setSelectionRange(3, 6);
    fireEvent.click(screen.getByRole("button", { name: "展开编辑" }));
    const editor = screen.getByRole("textbox", { name: "展开编辑" }) as HTMLTextAreaElement;
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 6]);
    editor.setSelectionRange(10, 12);
    fireEvent.select(editor);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect([input.selectionStart, input.selectionEnd]).toEqual([10, 12]);
  });

  it("offers the larger editor when text wraps beyond the visible input height", () => {
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLTextAreaElement.prototype, "clientHeight", "get").mockReturnValue(50);
    render(<Harness initialValue={"中".repeat(100)} />);
    expect(screen.getByRole("button", { name: "展开编辑" })).toBeTruthy();
  });
});
