import { describe, expect, it } from "vitest";
import { developmentIconPath } from "./appBranding";

describe("developmentIconPath", () => {
  it("uses the Loom PNG from the project build resources while developing", () => {
    expect(developmentIconPath("/workspace/loom", false)).toBe("/workspace/loom/build/icon.png");
  });

  it("does not depend on a source-tree icon after the app is packaged", () => {
    expect(developmentIconPath("/workspace/loom", true)).toBeUndefined();
  });
});
