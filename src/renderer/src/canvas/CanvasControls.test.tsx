// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasTitlebarActions, CanvasZoomControls } from "./CanvasControls";

function renderTitlebarActions(props?: Partial<React.ComponentProps<typeof CanvasTitlebarActions>>) {
  const onFit = vi.fn();
  const onTidy = vi.fn();
  const view = render(
    <>
      <div id="app-overlay-root" className="app-overlay-root" />
      <div className="titlebar-actions">
        <CanvasTitlebarActions onFit={onFit} onTidy={onTidy} {...props} />
      </div>
      <button type="button">外部动作</button>
    </>,
  );
  return { ...view, onFit, onTidy };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("split canvas controls", () => {
  it("renders titlebar actions separately from canvas-local zoom controls", () => {
    const titlebar = renderTitlebarActions();
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    const onResetZoom = vi.fn();
    render(
      <CanvasZoomControls
        zoom={0.875}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onResetZoom={onResetZoom}
      />,
    );

    const fit = screen.getByRole("button", { name: "适配全部节点" });
    const zoom = screen.getByLabelText("画布缩放");
    expect(fit.closest(".titlebar-actions")).toBeTruthy();
    expect(zoom.classList.contains("canvas-zoom")).toBe(true);
    expect(zoom.classList.contains("nodrag")).toBe(true);
    expect(document.querySelector(".canvas-actions")).toBeNull();
    expect(screen.getByText("88%")).toBeTruthy();

    fireEvent.click(fit);
    fireEvent.click(screen.getByRole("button", { name: "整理布局" }));
    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "回到 100%" }));

    expect(titlebar.onFit).toHaveBeenCalledOnce();
    expect(titlebar.onTidy).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onResetZoom).toHaveBeenCalledOnce();
  });
});

describe("canvas titlebar help", () => {
  it("moves keyboard focus into the announced dialog when opened from the help trigger", async () => {
    const user = userEvent.setup();
    renderTitlebarActions();
    const helpButton = screen.getByRole("button", { name: "画布帮助" });
    helpButton.focus();

    await user.keyboard("{Enter}");

    const panel = await screen.findByRole("dialog", { name: "画布帮助" });
    expect(panel.tabIndex).toBe(-1);
    expect(panel.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(panel);
    expect(screen.getByText(/拖动节点标题栏移动/).id).toBe(
      panel.getAttribute("aria-describedby"),
    );
  });

  it("portals an accessible fixed panel to the App overlay root using the button rect", async () => {
    renderTitlebarActions();
    const helpButton = screen.getByRole("button", { name: "画布帮助" });
    vi.spyOn(helpButton, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      height: 28,
      left: 872,
      right: 900,
      top: 12,
      width: 28,
      x: 872,
      y: 12,
      toJSON: () => ({}),
    });

    expect(helpButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(helpButton);

    const panel = await screen.findByRole("dialog", { name: "画布帮助" });
    const overlayRoot = document.querySelector("#app-overlay-root")!;
    expect(helpButton.getAttribute("aria-expanded")).toBe("true");
    expect(helpButton.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(helpButton.id);
    expect(overlayRoot.contains(panel)).toBe(true);
    expect(panel.closest(".titlebar-actions")).toBeNull();
    expect(panel.classList.contains("chrome-no-drag")).toBe(true);
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.top).toBe("48px");
    expect(panel.style.right).toBe(`${window.innerWidth - 900}px`);
  });

  it("closes on Escape and restores focus to the connected help button", async () => {
    renderTitlebarActions();
    const helpButton = screen.getByRole("button", { name: "画布帮助" });
    helpButton.focus();
    fireEvent.click(helpButton);
    await screen.findByRole("dialog", { name: "画布帮助" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "画布帮助" })).toBeNull());
    expect(document.activeElement).toBe(helpButton);
    expect(helpButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on an outside pointer press without stealing focus from that action", async () => {
    renderTitlebarActions();
    fireEvent.click(screen.getByRole("button", { name: "画布帮助" }));
    await screen.findByRole("dialog", { name: "画布帮助" });
    const outside = screen.getByRole("button", { name: "外部动作" });
    outside.focus();

    fireEvent.pointerDown(outside);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "画布帮助" })).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  it("removes the panel and document listeners when its owner unmounts", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const view = renderTitlebarActions();
    fireEvent.click(screen.getByRole("button", { name: "画布帮助" }));
    await screen.findByRole("dialog", { name: "画布帮助" });

    view.unmount();

    expect(screen.queryByRole("dialog", { name: "画布帮助" })).toBeNull();
    expect(remove.mock.calls.some(([type]) => type === "keydown")).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === "pointerdown")).toBe(true);
    expect(add.mock.calls.filter(([type]) => type === "keydown").length).toBe(
      remove.mock.calls.filter(([type]) => type === "keydown").length,
    );
    expect(add.mock.calls.filter(([type]) => type === "pointerdown").length).toBe(
      remove.mock.calls.filter(([type]) => type === "pointerdown").length,
    );
  });
});
