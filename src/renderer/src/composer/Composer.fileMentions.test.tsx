// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { SelectionContextNote } from "../../../common/selectionContext";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function TestComposer({ onSubmit, selectionNotes = [], onSelectionNotesChange }: { onSubmit: ReturnType<typeof vi.fn>; selectionNotes?: SelectionContextNote[]; onSelectionNotesChange?: (notes: SelectionContextNote[]) => void }) {
  const [value, setValue] = useState("");
  return (
    <Composer
      nodeId="node-1"
      value={value}
      onChange={setValue}
      busy={false}
      placeholder="Ask"
      canRegenerate={false}
      onSubmit={onSubmit}
      onStop={vi.fn()}
      onOpenPersona={vi.fn()}
      onClearNode={vi.fn()}
      onRegenerate={vi.fn()}
      onSetModel={vi.fn()}
      onCompact={vi.fn()}
      selectionNotes={selectionNotes}
      onSelectionNotesChange={onSelectionNotesChange}
    />
  );
}

describe("Composer file mentions", () => {
  it("keeps the selected file as a tag and sends its reference separately", async () => {
    const send = vi.fn();
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({
          ok: true,
          candidates: [{ root: "project:0", rootName: "loom", path: "src/index.ts", kind: "file" }],
        })),
      },
    };
    render(<TestComposer onSubmit={send} />);

    const input = screen.getByPlaceholderText("Ask");
    await userEvent.setup().type(input, "@");
    const option = await screen.findByRole("option", { name: /index\.ts/ });
    expect(option.querySelector("small")).toBeNull();
    fireEvent.click(option);

    expect(input).toHaveProperty("value", "");
    expect(screen.getByLabelText("已引用文件")).toBeTruthy();
    expect(screen.getByText("@index.ts", { selector: ".composer-file-mention__path" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "summarize this file", selectionStart: 19 } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledWith("summarize this file", [], [], [
      { root: "project:0", path: "src/index.ts" },
    ]));
  });

  it("allows a selected file tag to be removed without losing the surrounding text", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({
          ok: true,
          candidates: [{ root: "project:0", rootName: "loom", path: "src/index.ts", kind: "file" }],
        })),
      },
    };
    render(<TestComposer onSubmit={vi.fn()} />);

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Ask");
    await user.type(input, "before @");
    const option = await screen.findByRole("option", { name: /index\.ts/ });
    fireEvent.click(option);
    fireEvent.change(input, { target: { value: "before after", selectionStart: 12 } });
    await waitFor(() => expect(screen.getByRole("button", { name: "移除文件引用 src/index.ts" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "移除文件引用 src/index.ts" }));

    expect(input).toHaveProperty("value", "before after");
    expect(screen.queryByLabelText("已引用文件")).toBeNull();
  });

  it("keeps the textarea usable after dismissing the palette without selecting a file", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({
          ok: true,
          candidates: [{ root: "project:0", rootName: "loom", path: "src/index.ts", kind: "file" }],
        })),
      },
    };
    render(<TestComposer onSubmit={vi.fn()} />);

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Ask");
    await user.type(input, "@");
    await screen.findByRole("option", { name: /index\.ts/ });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("option", { name: /@src\/index\.ts/ })).toBeNull();
    await user.click(input);
    await user.type(input, "继续输入");
    expect(input).toHaveProperty("value", "@继续输入");
  });

  it("allows normal typing while the @ palette is open", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({
          ok: true,
          candidates: [{ root: "project:0", rootName: "loom", path: "src/index.ts", kind: "file" }],
        })),
      },
    };
    render(<TestComposer onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText("Ask");
    await userEvent.setup().type(input, "@src");

    expect(input).toHaveProperty("value", "@src");
    expect(document.activeElement).toBe(input);
  });

  it("keeps the textarea focusable when the open palette is clicked through", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({
          ok: true,
          candidates: [{ root: "project:0", rootName: "loom", path: "src/index.ts", kind: "file" }],
        })),
      },
    };
    render(<TestComposer onSubmit={vi.fn()} />);

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Ask");
    await user.type(input, "@");
    await screen.findByRole("option", { name: /index\.ts/ });
    await user.click(input);

    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("option", { name: /index\.ts/ })).toBeTruthy();
  });

  it("explains that a project without local roots cannot provide file mentions", async () => {
    (window as any).api = {
      canvas: {
        models: vi.fn(async () => []),
        fileCandidates: vi.fn(async () => ({ ok: true, candidates: [], reason: "no-source-roots" })),
      },
    };
    render(<TestComposer onSubmit={vi.fn()} />);

    await userEvent.setup().type(screen.getByPlaceholderText("Ask"), "@");

    expect(await screen.findByText("当前项目未关联本地目录")).toBeTruthy();
    expect(screen.getByText("@ 文件只支持当前项目目录中的文件。")).toBeTruthy();
    expect(screen.getByText("请先为项目关联本地目录，再重新使用 @。")).toBeTruthy();
  });

  it("shows pending selection notes, sends them without text, and allows removing one", async () => {
    const send = vi.fn();
    const onSelectionNotesChange = vi.fn();
    const notes = [{ id: "note-1", text: "选中的原文", annotation: "关注定义" }];
    (window as any).api = { canvas: { models: vi.fn(async () => []) } };
    render(<TestComposer onSubmit={send} selectionNotes={notes} onSelectionNotesChange={onSelectionNotesChange} />);

    const tag = screen.getByRole("button", { name: /1 条注释/ });
    expect(tag).toBeTruthy();
    await userEvent.setup().click(tag);
    expect(screen.getByText("选中的原文")).toBeTruthy();
    expect(screen.getByText("关注定义")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "删除注释 1" }));
    expect(onSelectionNotesChange).toHaveBeenCalledWith([]);
    expect(screen.queryByText("待发送注释")).toBeNull();
  });

  it("closes the hover card and reuses the annotation editor for editing", async () => {
    const send = vi.fn();
    const onSelectionNotesChange = vi.fn();
    const notes = [{ id: "note-1", text: "选中的原文", annotation: "旧注释" }];
    (window as any).api = { canvas: { models: vi.fn(async () => []) } };
    render(<TestComposer onSubmit={send} selectionNotes={notes} onSelectionNotesChange={onSelectionNotesChange} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /1 条注释/ }));
    expect(screen.getByText("选中的原文")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "编辑注释 1" }));

    expect(screen.queryByText("待发送注释")).toBeNull();
    const editor = screen.getByDisplayValue("旧注释");
    fireEvent.change(editor, { target: { value: "新注释" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "确认" }));
    expect(onSelectionNotesChange).toHaveBeenLastCalledWith([{ id: "note-1", text: "选中的原文", annotation: "新注释" }]);
  });

  it("submits a selection-context-only draft", async () => {
    const send = vi.fn();
    const notes = [{ id: "note-1", text: "只发送这一段", annotation: "" }];
    (window as any).api = { canvas: { models: vi.fn(async () => []) } };
    render(<TestComposer onSubmit={send} selectionNotes={notes} />);

    await userEvent.setup().click(screen.getByTitle("发送"));
    expect(send).toHaveBeenCalledWith("", [], [], [], notes);
  });

  it("restores selection notes when the send is rejected", async () => {
    const send = vi.fn(async () => ({ ok: false, reason: "selection-context-error" }));
    const onSelectionNotesChange = vi.fn();
    const notes = [{ id: "note-1", text: "需要保留", annotation: "失败后恢复" }];
    (window as any).api = { canvas: { models: vi.fn(async () => []) } };
    render(<TestComposer onSubmit={send} selectionNotes={notes} onSelectionNotesChange={onSelectionNotesChange} />);

    await userEvent.setup().click(screen.getByTitle("发送"));
    await waitFor(() => expect(onSelectionNotesChange).toHaveBeenLastCalledWith(notes));
  });
});
