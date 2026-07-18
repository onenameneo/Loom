import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as layoutModule from "./layout";

const fallback = { x: 10, y: 20, width: 360, height: 440 };

describe("canvas layout helpers", () => {
  it("remounts and resets the sole resize control after cancellation", () => {
    const nodeSource = readFileSync(new URL("./ChatThreadNode.tsx", import.meta.url), "utf8");
    const canvasSource = readFileSync(new URL("./Canvas.tsx", import.meta.url), "utf8");

    expect(nodeSource).toContain("key={data.resizeControlEpoch}");
    expect(nodeSource).toContain("resizeTokenRef.current = null;");
    expect(canvasSource).toContain("resizeControlEpoch: cancelled.token");
    expect(canvasSource).toContain("resizeSessionRef.current.recover(token, id)");
  });

  it("keeps the bottom-right resize control inside the card outline", () => {
    const css = readFileSync(new URL("./canvas.css", import.meta.url), "utf8");
    const controlRule = css.match(
      /\.react-flow__node \.react-flow__resize-control\.node-resize-control\.bottom\.right \{([^}]*)\}/,
    )?.[1];

    expect(css).toContain(
      ".react-flow__node .react-flow__resize-control.node-resize-control.bottom.right",
    );
    expect(controlRule).toContain("left: auto;");
    expect(controlRule).toContain("top: auto;");
    expect(controlRule).toContain("translate: none;");
    expect(controlRule).toContain("transform: none;");
  });

  it("resolves dirty layout before persisted and default layout", () => {
    const resolve = (layoutModule as any).resolveNodeLayout;
    const persisted = { x: 30, y: 40, width: 380, height: 460 };
    const dirty = { x: 90, y: 100, width: 410, height: 500 };

    expect(resolve?.({ layout: persisted }, fallback, dirty)).toEqual(dirty);
    expect(resolve?.({ layout: persisted }, fallback)).toEqual(persisted);
    expect(resolve?.({}, fallback)).toEqual(fallback);
  });

  it("tidies positions without changing node dimensions", () => {
    const tidy = (layoutModule as any).applyTidyPositions;
    const nodes = [
      {
        id: "n1",
        position: { x: 1, y: 2 },
        style: { width: 420, height: 310 },
        data: {},
      },
    ];

    const result = tidy?.(nodes, { n1: { x: 200, y: 80 } });

    expect(result?.[0].position).toEqual({ x: 200, y: 80 });
    expect(result?.[0].style).toEqual({ width: 420, height: 310 });
  });

  it("reconciles node data while preserving live layout and selection", () => {
    const reconcile = (layoutModule as any).reconcileExistingNode;
    const existing = {
      id: "n1",
      position: { x: 200, y: 80 },
      style: { width: 420, height: 310 },
      selected: true,
      data: { title: "Old", messages: [] },
    };

    const result = reconcile?.(existing, { title: "New", messages: [{ text: "hi" }] });

    expect(result).toMatchObject({
      position: { x: 200, y: 80 },
      style: { width: 420, height: 310 },
      selected: true,
      data: { title: "New", messages: [{ text: "hi" }] },
    });
  });

  it("reads the canonical layout from position and numeric style dimensions", () => {
    const read = (layoutModule as any).readNodeLayout;
    const node = {
      id: "n1",
      position: { x: 120, y: -30 },
      style: { width: 410, height: 330 },
      measured: { width: 999, height: 999 },
      data: {},
    };

    expect(read?.(node)).toEqual({ x: 120, y: -30, width: 410, height: 330 });
  });
});
