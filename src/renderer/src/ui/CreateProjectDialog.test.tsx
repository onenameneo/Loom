// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateProjectDialog } from "./dialogs";

afterEach(cleanup);

describe("CreateProjectDialog", () => {
  it("submits a project name with optional source roots", async () => {
    const onSubmit = vi.fn();
    render(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onPickFolder={vi.fn(async () => "/Users/neo/code/demo-project")}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("Source Roots")).toBeTruthy();
    fireEvent.click(screen.getByText("添加 Loom 可读取和编辑的 Source Root"));
    await waitFor(() => expect(screen.getByDisplayValue("demo-project")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "demo-project",
      sourceRoots: ["/Users/neo/code/demo-project"],
    });
  });
});
