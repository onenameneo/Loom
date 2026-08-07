// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatThreadNode, selectionToolbarFromRects } from "./ChatThreadNode";
import "./canvas.css";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, Handle: () => null };
});

function ViewportZoom({ zoom }: { zoom: number }) {
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ transform: [0, 0, zoom] });
  }, [store, zoom]);
  return null;
}

function ResizeNodeAtZoom({ zoom }: { zoom: number }) {
  return (
    <ReactFlowProvider
      initialNodes={[
        {
          id: "n1",
          position: { x: 0, y: 0 },
          measured: { width: 360, height: 440 },
          data: {},
        },
      ]}
      initialWidth={800}
      initialHeight={600}
    >
      <ViewportZoom zoom={zoom} />
      <ChatThreadNode
        id="n1"
        selected
        data={{
          title: "Main",
          messages: [],
          onResizeStart: vi.fn(() => 1),
          shouldResize: vi.fn(() => true),
        }}
      />
    </ReactFlowProvider>
  );
}

afterEach(cleanup);

describe("ChatThreadNode resize control geometry", () => {
  it.each([0.3, 1, 1.6])(
    "keeps the scaled 22px hit target inside the bottom-right corner at zoom %s",
    async (zoom) => {
      const view = render(<ResizeNodeAtZoom zoom={zoom} />);
      const control = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>(".node-resize-control");
        expect(element).toBeTruthy();
        return element!;
      });

      await waitFor(() => {
        const controlScale = Number(control.style.scale || "1");
        expect(control.style.width).toBe("22px");
        const width = Number.parseFloat(control.style.width);
        expect(width * zoom * controlScale).toBeGreaterThanOrEqual(22);
      });
      expect(control.style.transformOrigin).toBe("bottom right");
      expect(control.style.right).toBe("0px");
      expect(control.style.bottom).toBe("0px");
    },
  );
});

describe("ChatThreadNode selection toolbar geometry", () => {
  it("converts viewport selection coordinates back into unscaled node coordinates", () => {
    const toolbar = selectionToolbarFromRects({
      text: "Claude",
      selection: { left: 240, top: 300, bottom: 318, width: 54, height: 18 },
      container: { left: 120, top: 180, bottom: 510, width: 270, height: 330 },
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 360,
      zoom: 0.75,
    });

    expect(toolbar).toMatchObject({
      text: "Claude",
      x: 196,
      y: 144,
      place: "top",
    });
  });
});

describe("ChatThreadNode resize preview", () => {
  it("renders a bounded body preview while resizing instead of the full message tree", () => {
    render(
      <ChatThreadNode
        id="n1"
        className="is-resizing"
        data={{
          title: "Main",
          messages: [{ id: 1, role: "assistant", text: "A long response that should be summarized during resize." }],
          isResizing: true,
        }}
      />,
    );

    expect(screen.getByLabelText("正在调整窗口")).toBeTruthy();
    expect(screen.getByText("1 条消息")).toBeTruthy();
    expect(document.querySelector(".m")).toBeNull();
  });
});
