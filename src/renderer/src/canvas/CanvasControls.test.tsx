// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasControls } from "./CanvasControls";

afterEach(cleanup);

describe("CanvasControls", () => {
  it("exposes the drafting controls with names and current zoom", () => {
    const onFit = vi.fn();
    const onTidy = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    const onResetZoom = vi.fn();

    render(
      <CanvasControls
        zoom={0.875}
        onFit={onFit}
        onTidy={onTidy}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onResetZoom={onResetZoom}
      />,
    );

    expect(screen.getByText("88%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "适配全部节点" }));
    fireEvent.click(screen.getByRole("button", { name: "整理布局" }));
    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "回到 100%" }));

    expect(onFit).toHaveBeenCalledOnce();
    expect(onTidy).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onResetZoom).toHaveBeenCalledOnce();
  });

  it("opens a concise canvas help panel", () => {
    render(
      <CanvasControls
        zoom={1}
        onFit={vi.fn()}
        onTidy={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onResetZoom={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "画布帮助" }));
    expect(screen.getByText(/拖动节点标题栏移动/)).toBeTruthy();
  });
});
