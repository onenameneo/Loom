// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Canvas from "./Canvas";
import { TitlebarProvider } from "../titlebar/Titlebar";

const harness = vi.hoisted(() => ({ props: null as any, node: null as any }));
const layoutStore = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
  getDirty: vi.fn(() => undefined),
  remove: vi.fn(),
}));

vi.mock("./CanvasLayoutContext", () => ({
  useCanvasLayoutStore: () => layoutStore,
  useCanvasLayoutPersistence: () => ({ status: "idle", error: null, retry: vi.fn() }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const React = await import("react");
  return {
    ...actual,
    Background: () => null,
    MiniMap: () => null,
    ReactFlow: (props: any) => {
      harness.props = props;
      React.useLayoutEffect(() => {
        props.onInit?.({
          fitView: vi.fn(),
          setCenter: vi.fn(),
          zoomIn: vi.fn(),
          zoomOut: vi.fn(),
          zoomTo: vi.fn(),
          setNodes: vi.fn(),
          setEdges: vi.fn(),
        });
      }, [props.onInit]);
      const node = props.nodes?.[0];
      harness.node = node;
      const width = node?.width ?? node?.style?.width;
      const height = node?.height ?? node?.style?.height;
      return (
        <div
          data-testid="flow"
          className={props.className}
          data-nodes-draggable={String(props.nodesDraggable)}
          data-pan-on-drag={String(props.panOnDrag)}
        >
          {node && (
            <div
              data-testid="displayed-node"
              data-width={String(width)}
              data-height={String(height)}
              data-x={String(node.position.x)}
              data-y={String(node.position.y)}
            />
          )}
          {props.children}
        </div>
      );
    },
  };
});

const initial = { x: 240, y: 48, width: 360, height: 440 };
const moved = { ...initial, width: 470, height: 520 };
const stale = { ...initial, width: 650, height: 645 };

function nodeActions() {
  return harness.node.data as Record<string, (...args: any[]) => any>;
}

async function renderCanvas() {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      canvas: {
        open: vi.fn(async () => [
          {
            id: "n1",
            sessionId: "session-1",
            projectId: "project-1",
            title: "Main",
            messages: [],
          },
        ]),
      },
    },
  });
  const view = render(
    <TitlebarProvider defaultDescriptor={{ title: "Canvas" }}>
      <Canvas sessionId="session-1" />
    </TitlebarProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("displayed-node")).toBeTruthy());
  return view;
}

afterEach(cleanup);

beforeEach(() => {
  harness.props = null;
  harness.node = null;
  layoutStore.enqueue.mockReset();
  layoutStore.enqueueMany.mockReset();
  layoutStore.getDirty.mockReset();
  layoutStore.getDirty.mockReturnValue(undefined);
  Reflect.deleteProperty(window, "api");
});

describe("Canvas resize lifecycle", () => {
  it("keeps canonical dimensions after blur, late callbacks, and queued React Flow changes", async () => {
    await renderCanvas();
    let token = 0;

    act(() => {
      token = nodeActions().onResizeStart("n1", initial);
      nodeActions().onResize("n1", token, moved);
    });
    await waitFor(() => {
      expect(screen.getByTestId("flow").dataset.nodesDraggable).toBe("false");
      expect(screen.getByTestId("displayed-node").dataset.width).toBe("470");
    });

    act(() => window.dispatchEvent(new Event("blur")));
    await waitFor(() => {
      expect(screen.getByTestId("flow").dataset.nodesDraggable).toBe("true");
      expect(screen.getByTestId("flow").dataset.panOnDrag).toBe("true");
      expect(screen.getByTestId("flow").classList.contains("is-resizing")).toBe(false);
    });

    expect(nodeActions().shouldResize?.("n1", token, stale)).toBe(false);
    act(() => {
      nodeActions().onResize("n1", token, stale);
      nodeActions().onResizeEnd("n1", token, stale);
      harness.props.onNodesChange([
        {
          id: "n1",
          type: "dimensions",
          resizing: true,
          setAttributes: true,
          dimensions: { width: stale.width, height: stale.height },
        },
      ]);
      harness.props.onNodesChange([
        {
          id: "n1",
          type: "dimensions",
          resizing: false,
          dimensions: { width: stale.width, height: stale.height },
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("displayed-node").dataset.width).toBe("470");
      expect(screen.getByTestId("displayed-node").dataset.height).toBe("520");
      expect(screen.getByTestId("flow").dataset.nodesDraggable).toBe("true");
      expect(screen.getByTestId("flow").dataset.panOnDrag).toBe("true");
    });
    expect(layoutStore.enqueue).toHaveBeenCalledOnce();
    expect(layoutStore.enqueue).toHaveBeenCalledWith("session-1", "n1", moved);
  });

  it("does not let a start-only baseline revert or enqueue after a later node drag", async () => {
    const view = await renderCanvas();
    const dragged = { x: 320, y: 96, width: initial.width, height: initial.height };

    act(() => {
      nodeActions().onResizeStart("n1", initial);
    });

    expect(screen.getByTestId("flow").dataset.nodesDraggable).toBe("true");
    expect(screen.getByTestId("flow").dataset.panOnDrag).toBe("true");
    expect(screen.getByTestId("flow").classList.contains("is-resizing")).toBe(false);

    act(() => {
      harness.props.onNodesChange([
        { id: "n1", type: "position", position: { x: dragged.x, y: dragged.y }, dragging: true },
      ]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("displayed-node").dataset.x).toBe("320");
      expect(screen.getByTestId("displayed-node").dataset.y).toBe("96");
    });

    act(() => harness.props.onNodeDragStart(null, harness.node));
    act(() => harness.props.onNodeDragStop(null, { ...harness.node, position: { x: dragged.x, y: dragged.y } }));

    expect(layoutStore.enqueue).toHaveBeenCalledOnce();
    expect(layoutStore.enqueue).toHaveBeenCalledWith("session-1", "n1", dragged);

    act(() => window.dispatchEvent(new Event("blur")));

    await waitFor(() => {
      expect(screen.getByTestId("displayed-node").dataset.x).toBe("320");
      expect(screen.getByTestId("displayed-node").dataset.y).toBe("96");
    });
    view.unmount();
    expect(layoutStore.enqueue).toHaveBeenCalledOnce();
    expect(layoutStore.enqueue).not.toHaveBeenCalledWith("session-1", "n1", initial);
  });
});
