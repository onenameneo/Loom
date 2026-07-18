// @vitest-environment jsdom
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import Canvas from "./Canvas";
import { AppTitlebar, TitlebarProvider, useTitlebarActions } from "../titlebar/Titlebar";

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  setCenter: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomTo: vi.fn(),
}));

const layoutStore = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
  getDirty: vi.fn(() => undefined),
  remove: vi.fn(),
}));

vi.mock("./CanvasLayoutContext", () => ({
  CanvasLayoutProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useCanvasLayoutStore: () => layoutStore,
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => <div data-testid="background" />,
    BackgroundVariant: { Dots: "dots" },
    MiniMap: () => <div data-testid="minimap" />,
    ReactFlow: ({
      children,
      onInit,
      onMove,
    }: {
      children: ReactNode;
      onInit?: (instance: typeof flow) => void;
      onMove?: (event: unknown, viewport: { zoom: number }) => void;
    }) => {
      React.useLayoutEffect(() => onInit?.(flow), [onInit]);
      return (
        <div data-testid="react-flow">
          {children}
          <button type="button" onClick={() => onMove?.(null, { zoom: 0.75 })}>
            模拟画布移动
          </button>
        </div>
      );
    },
    useEdgesState: (initial: unknown[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, vi.fn()] as const;
    },
    useNodesState: (initial: unknown[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, vi.fn()] as const;
    },
  };
});

function PreviousActions() {
  const actions = useMemo(() => <button type="button">上一个动作</button>, []);
  useTitlebarActions(actions);
  return null;
}

function Surface({ canvas }: { canvas: boolean }) {
  return canvas ? <Canvas workspaceId="workspace-1" /> : <div>对话 surface</div>;
}

afterEach(cleanup);

beforeEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  Object.values(flow).forEach((mock) => mock.mockReset());
});

describe("Canvas titlebar integration", () => {
  it("gives the App shell exactly one shared overlay root", () => {
    render(<App />);

    expect(document.querySelectorAll("#app-overlay-root")).toHaveLength(1);
    expect(document.querySelector("#app-overlay-root")?.classList.contains("chrome-no-drag")).toBe(true);
  });

  it("registers stable canvas actions and reveals the previous slot on surface switch", async () => {
    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <div id="app-overlay-root" className="app-overlay-root" />
        <AppTitlebar collapsed={false} platform="browser" />
        <PreviousActions />
        <Surface canvas />
      </TitlebarProvider>,
    );

    const fit = await screen.findByRole("button", { name: "适配全部节点" });
    const tidy = screen.getByRole("button", { name: "整理布局" });
    const help = screen.getByRole("button", { name: "画布帮助" });
    expect(fit.closest(".titlebar-actions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "上一个动作" })).toBeNull();
    expect(document.querySelector(".canvas-actions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "模拟画布移动" }));
    expect(screen.getByRole("button", { name: "适配全部节点" })).toBe(fit);

    fireEvent.click(fit);
    expect(flow.fitView).toHaveBeenCalledOnce();
    fireEvent.click(tidy);
    fireEvent.click(help);
    expect(await screen.findByRole("dialog", { name: "画布帮助" })).toBeTruthy();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <div id="app-overlay-root" className="app-overlay-root" />
        <AppTitlebar collapsed={false} platform="browser" />
        <PreviousActions />
        <Surface canvas={false} />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "上一个动作" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "适配全部节点" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "画布帮助" })).toBeNull();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar collapsed={false} platform="browser" />
        <Surface canvas={false} />
      </TitlebarProvider>,
    );
    await waitFor(() => expect(document.querySelector(".titlebar-actions")).toBeNull());
  });

  it("does not leave canvas actions after a transient mount unmounts", async () => {
    function TransientCanvas() {
      const [mounted, setMounted] = useState(true);
      useEffect(() => setMounted(false), []);
      return mounted ? <Canvas workspaceId="workspace-1" /> : null;
    }

    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar collapsed={false} platform="browser" />
        <PreviousActions />
        <TransientCanvas />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "上一个动作" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "适配全部节点" })).toBeNull();
  });
});
