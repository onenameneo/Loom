import { describe, expect, it } from "vitest";
import * as layoutModule from "./layout";

const fallback = { x: 10, y: 20, width: 360, height: 440 };

describe("canvas layout helpers", () => {
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

  it("keeps the preferred branch placement when it does not overlap", () => {
    const place = (layoutModule as any).findBranchPlacement;
    const preferred = { x: 510, y: 20, width: 360, height: 440 };

    expect(
      place?.({
        existing: [{ x: 0, y: 0, width: 360, height: 440 }],
        preferred,
        gapX: 150,
        rowH: 300,
      }),
    ).toEqual(preferred);
  });

  it("moves a new branch to the nearest open row when the preferred slot is occupied", () => {
    const place = (layoutModule as any).findBranchPlacement;

    expect(
      place?.({
        existing: [
          { x: 510, y: 20, width: 360, height: 440 },
          { x: 510, y: 540, width: 360, height: 440 },
        ],
        preferred: { x: 510, y: 20, width: 360, height: 440 },
        gapX: 150,
        rowH: 520,
      }),
    ).toEqual({ x: 510, y: -500, width: 360, height: 440 });
  });
});
