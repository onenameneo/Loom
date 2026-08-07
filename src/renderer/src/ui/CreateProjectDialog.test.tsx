// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateProjectDialog } from "./dialogs";

afterEach(cleanup);

describe("CreateProjectDialog", () => {
  it("exposes the dialog, field, and directory help with accessible names and associations", async () => {
    render(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onPickFolder={vi.fn(async () => undefined)}
        onSubmit={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "创建项目" });
    const name = screen.getByLabelText("项目名称");
    const description = screen.getByText("为工作内容命名，并按需授权 Loom 访问项目目录。");
    const picker = screen.getByRole("button", { name: "添加项目目录" });
    const help = screen.getByText("允许 Loom 在此目录中读取和编辑文件");

    expect(screen.getByText("项目目录（可选）")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toContain(description.id);
    expect(picker.getAttribute("aria-describedby")?.split(" ")).toContain(help.id);
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("infers Windows basenames, ignores duplicate directories, and exposes a path-specific remove action", async () => {
    const folder = "C:\\code\\demo-project";
    const onPickFolder = vi.fn(async () => folder);
    render(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onPickFolder={onPickFolder}
        onSubmit={vi.fn()}
      />,
    );

    const picker = screen.getByRole("button", { name: "添加项目目录" });
    fireEvent.click(picker);
    await waitFor(() => expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("demo-project"));
    fireEvent.click(picker);

    await waitFor(() => expect(onPickFolder).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText(folder)).toHaveLength(1);
    expect(screen.getByRole("button", { name: `移除目录 ${folder}` })).toBeTruthy();
  });

  it("preserves a manually entered name when a directory is picked and submits through the form", async () => {
    const onSubmit = vi.fn();
    render(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onPickFolder={vi.fn(async () => "/Users/neo/code/demo-project")}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "手动命名" } });
    fireEvent.click(screen.getByRole("button", { name: "添加项目目录" }));
    await screen.findByText("/Users/neo/code/demo-project");

    const form = screen.getByLabelText("项目名称").closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "手动命名",
        sourceRoots: ["/Users/neo/code/demo-project"],
      });
    });
  });

  it("associates a rejecting picker alert with the directory action", async () => {
    render(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onPickFolder={vi.fn(async () => {
          throw new Error("无法打开目录选择器");
        })}
        onSubmit={vi.fn()}
      />,
    );

    const picker = screen.getByRole("button", { name: "添加项目目录" });
    fireEvent.click(picker);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("无法打开目录选择器");
    expect(picker.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
  });

  it("keeps a rejected submission open and exposes the failure", async () => {
    const onOpenChange = vi.fn();
    render(
      <CreateProjectDialog
        open
        onOpenChange={onOpenChange}
        onPickFolder={vi.fn(async () => undefined)}
        onSubmit={vi.fn(async () => {
          throw new Error("项目创建失败");
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "demo" } });
    fireEvent.submit(screen.getByLabelText("项目名称").closest("form")!);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "项目创建失败");
    expect(screen.getByRole("dialog", { name: "创建项目" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks duplicate submission, mutations, and every dismiss route while submission is pending", async () => {
    let resolveSubmit!: () => void;
    const submission = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn(() => submission);
    render(
      <CreateProjectDialog
        open
        onOpenChange={onOpenChange}
        onPickFolder={vi.fn(async () => "/code/demo")}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加项目目录" }));
    const remove = await screen.findByRole("button", { name: "移除目录 /code/demo" });
    const form = screen.getByLabelText("项目名称").closest("form")!;
    const create = screen.getByRole("button", { name: "创建项目" }) as HTMLButtonElement;
    fireEvent.submit(form);

    const cancel = screen.getByRole("button", { name: "取消" }) as HTMLButtonElement;
    const close = screen.getByRole("button", { name: "关闭" }) as HTMLButtonElement;
    const picker = screen.getByRole("button", { name: "添加项目目录" }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(true));
    expect(create.textContent).toBe("正在创建...");

    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    expect(picker.disabled).toBe(true);
    expect((remove as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(form);
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    const overlay = document.querySelector(".dlg-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    resolveSubmit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("restores focus after an ordinary close and resets all product state on each fresh open", async () => {
    const user = userEvent.setup();
    const onPickFolder = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce("/code/first-project")
      .mockRejectedValueOnce(new Error("选择目录失败"));
    const onSubmit = vi.fn(async () => {
      throw new Error("提交失败");
    });

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>打开创建项目</button>
          <CreateProjectDialog
            open={open}
            onOpenChange={setOpen}
            onPickFolder={onPickFolder}
            onSubmit={onSubmit}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开创建项目" });
    await user.click(trigger);
    const name = screen.getByLabelText("项目名称") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name));

    await user.click(screen.getByRole("button", { name: "添加项目目录" }));
    await screen.findByText("/code/first-project");
    await user.click(screen.getByRole("button", { name: "添加项目目录" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "选择目录失败");
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull());
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    const reopenedName = screen.getByLabelText("项目名称") as HTMLInputElement;
    expect(reopenedName.value).toBe("");
    expect(screen.queryByText("/code/first-project")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a stale folder pick after close and reopen without clearing the current pick state", async () => {
    let resolveStale!: (path: string) => void;
    let resolveCurrent!: (path: string) => void;
    const stalePick = new Promise<string>((resolve) => {
      resolveStale = resolve;
    });
    const currentPick = new Promise<string>((resolve) => {
      resolveCurrent = resolve;
    });
    const onPickFolder = vi
      .fn<() => Promise<string | undefined>>()
      .mockImplementationOnce(() => stalePick)
      .mockImplementationOnce(() => currentPick);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>再次打开</button>
          <CreateProjectDialog
            open={open}
            onOpenChange={setOpen}
            onPickFolder={onPickFolder}
            onSubmit={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "添加项目目录" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "再次打开" }));
    const currentPicker = screen.getByRole("button", { name: "添加项目目录" }) as HTMLButtonElement;
    fireEvent.click(currentPicker);
    await waitFor(() => expect(onPickFolder).toHaveBeenCalledTimes(2));

    await act(async () => resolveStale("/stale/old-project"));

    expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("/stale/old-project")).toBeNull();
    expect(currentPicker.disabled).toBe(true);

    await act(async () => resolveCurrent("/current/new-project"));
    await waitFor(() => expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("new-project"));
    expect(screen.getByText("/current/new-project")).toBeTruthy();
    expect(currentPicker.disabled).toBe(false);
  });
});
