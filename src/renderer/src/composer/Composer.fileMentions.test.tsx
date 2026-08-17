// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function TestComposer({ onSubmit }: { onSubmit: ReturnType<typeof vi.fn> }) {
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
});
