// @vitest-environment jsdom
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import Canvas from "./Canvas";
import SessionCanvas from "./SessionCanvas";
import { AppTitlebar, TitlebarProvider, useTitlebarActions } from "../titlebar/Titlebar";

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  setCenter: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomTo: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
}));

const reactFlowProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

const layoutPersistence = vi.hoisted(() => ({
  current: { status: "idle", error: null as "storage" | "invalid" | null, retry: vi.fn() },
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
  useCanvasLayoutPersistence: () => layoutPersistence.current,
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const React = await import("react");
  const { BranchContext } = await import("./branch");
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Background: () => <div data-testid="background" />,
    BackgroundVariant: { Dots: "dots" },
    MiniMap: () => <div data-testid="minimap" />,
    ReactFlow: (props: {
      children: ReactNode;
      onInit?: (instance: typeof flow) => void;
      onMoveEnd?: (event: unknown, viewport: { zoom: number }) => void;
    }) => {
      const { children, onInit } = props;
      reactFlowProps.current = props as unknown as Record<string, unknown>;
      React.useLayoutEffect(() => onInit?.(flow), [onInit]);
      return (
        <div data-testid="react-flow">
          {children}
          <BranchContext.Consumer>
            {(branch) => (
              <button type="button" onClick={() => void branch?.onBranch("root", "branch seed", false)}>
                模拟新建分支
              </button>
            )}
          </BranchContext.Consumer>
          <button type="button" onClick={() => props.onMoveEnd?.(null, { zoom: 0.75 })}>
            模拟画布移动
          </button>
        </div>
      );
    },
  };
});

function PreviousActions() {
  const actions = useMemo(() => <button type="button">上一个动作</button>, []);
  useTitlebarActions(actions);
  return null;
}

function Surface({ canvas }: { canvas: boolean }) {
  return canvas ? <Canvas sessionId="session-1" /> : <div>对话 surface</div>;
}

afterEach(cleanup);

beforeEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  Object.values(flow).forEach((mock) => mock.mockReset());
  Object.values(layoutStore).forEach((mock) => mock.mockReset());
  layoutStore.getDirty.mockReturnValue(undefined);
  reactFlowProps.current = null;
  layoutPersistence.current = { status: "idle", error: null, retry: vi.fn() };
});

describe("Canvas titlebar integration", () => {
  it("disables React Flow modifier and drag multi-selection paths", async () => {
    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <Canvas sessionId="session-1" />
      </TitlebarProvider>,
    );

    await screen.findByTestId("react-flow");
    expect(reactFlowProps.current?.multiSelectionKeyCode).toBeNull();
    expect(reactFlowProps.current?.selectionKeyCode).toBeNull();
    expect(reactFlowProps.current?.selectionOnDrag).toBe(false);
  });

  it("shows a retryable unsaved-layout notice only while persistence has failed", async () => {
    layoutPersistence.current = { status: "error", error: "storage", retry: vi.fn() };
    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <Canvas sessionId="session-1" />
      </TitlebarProvider>,
    );

    expect(
      (await screen.findByRole("status", { name: "布局保存状态" })).textContent,
    ).toContain("布局尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "重试保存布局" }));
    expect(layoutPersistence.current.retry).toHaveBeenCalledOnce();

    layoutPersistence.current = { status: "idle", error: null, retry: vi.fn() };
    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <Canvas sessionId="session-1" />
      </TitlebarProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "布局保存状态" })).toBeNull(),
    );
  });

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
      return mounted ? <Canvas sessionId="session-1" /> : null;
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

  it("keeps project ownership on optimistic branch nodes", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        canvas: {
          open: vi.fn(async () => [
            {
              id: "root",
              sessionId: "session-1",
              projectId: "project-1",
              title: "Main",
              mountAncestors: false,
              messages: [],
            },
          ]),
          create: vi.fn(async () => ({
            id: "branch-1",
            sessionId: "session-1",
            projectId: "project-1",
            parentId: "root",
            title: "新会话",
            seed: { text: "branch seed", from: "Main", parent: "root" },
            mountAncestors: false,
            messages: [],
          })),
        },
      },
    });
    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <Canvas sessionId="session-1" />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(reactFlowProps.current?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "root" }),
    ])));
    fireEvent.click(screen.getByRole("button", { name: "模拟新建分支" }));

    await waitFor(() => {
      const latest = reactFlowProps.current?.nodes as any[];
      const branch = latest.find((node) => node.id === "branch-1");
      expect(branch?.data.projectId).toBe("project-1");
      expect(branch?.data.sessionId).toBe("session-1");
    });
    expect(window.api?.canvas.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "branch seed",
      seed: { text: "branch seed", from: "Main", parent: "root" },
    }));
    expect(layoutStore.enqueue).toHaveBeenCalledWith("session-1", "branch-1", expect.any(Object));
  });

  it("keeps the externally focused canvas node selected after framing it", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        canvas: {
          open: vi.fn(async () => [
            {
              id: "root",
              sessionId: "session-1",
              projectId: "project-1",
              title: "起点",
              mountAncestors: false,
              messages: [],
            },
            {
              id: "child",
              sessionId: "session-1",
              projectId: "project-1",
              parentId: "root",
              title: "新会话",
              mountAncestors: false,
              messages: [],
            },
          ]),
        },
      },
    });
    const onNodeChange = vi.fn();

    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <SessionCanvas
          sessionId="session-1"
          sessionName="workspace"
          noKey={false}
          goSettings={vi.fn()}
          activeNodeId="child"
          onNodeChange={onNodeChange}
        />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(flow.setCenter).toHaveBeenCalled());
    expect(onNodeChange).not.toHaveBeenCalledWith(null);
  });
});
