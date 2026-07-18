// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatThreadNode } from "./ChatThreadNode";
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
          mountAncestors: false,
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
