import { describe, expect, it } from "vitest";
import * as storeModule from "./store";

describe("node layout validation", () => {
  it("accepts finite layouts above the minimum size", () => {
    const validate = (storeModule as any).isValidNodeLayout;
    expect(validate?.({ x: -20, y: 40, width: 360, height: 260 })).toBe(true);
  });

  it("rejects non-finite coordinates and undersized nodes", () => {
    const validate = (storeModule as any).isValidNodeLayout;
    expect(validate?.({ x: Number.NaN, y: 0, width: 360, height: 260 })).toBe(false);
    expect(validate?.({ x: 0, y: 0, width: 287, height: 260 })).toBe(false);
    expect(validate?.({ x: 0, y: 0, width: 360, height: 219 })).toBe(false);
  });
});
