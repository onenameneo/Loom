import { describe, expect, it } from "vitest";
import type { Store } from "./store";
import * as persistence from "./layoutPersistence";

const layout = { x: 10, y: 20, width: 360, height: 260 };

function fakeStore(overrides: Partial<Store>): Store {
  return overrides as Store;
}

describe("layout persistence result mapping", () => {
  it("rejects invalid layouts before touching storage", () => {
    let called = false;
    const store = fakeStore({
      updateNodeLayout: () => {
        called = true;
        return true;
      },
    });

    const result = (persistence as any).saveNodeLayout?.(store, "n1", { ...layout, width: 2 });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(called).toBe(false);
  });

  it("maps missing nodes and storage exceptions", () => {
    const missing = fakeStore({ updateNodeLayout: () => false });
    const broken = fakeStore({
      updateNodeLayout: () => {
        throw new Error("disk full");
      },
    });

    expect((persistence as any).saveNodeLayout?.(missing, "gone", layout)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect((persistence as any).saveNodeLayout?.(broken, "n1", layout)).toEqual({
      ok: false,
      reason: "storage",
    });
  });

  it("returns updated ids for a successful batch", () => {
    const store = fakeStore({ updateNodeLayouts: () => ["n1"] });

    expect(
      (persistence as any).saveNodeLayouts?.(store, [
        { id: "n1", layout },
        { id: "gone", layout },
      ]),
    ).toEqual({ ok: true, updatedIds: ["n1"] });
  });
});
