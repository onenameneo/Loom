// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as module from "./sidebarState";

describe("sidebar shell state", () => {
  it("treats only the stored value 1 as collapsed", () => {
    const read = (module as any).readSidebarCollapsed;
    expect(read).toBeTypeOf("function");
    expect(read({ getItem: () => "1" })).toBe(true);
    expect(read({ getItem: () => "0" })).toBe(false);
    expect(read({ getItem: () => "broken" })).toBe(false);
    expect(read({ getItem: () => { throw new Error("denied"); } })).toBe(false);
  });

  it("allows the browser shortcut only outside editable or composing targets", () => {
    const guard = (module as any).isBrowserSidebarShortcut;
    expect(guard).toBeTypeOf("function");
    const div = document.createElement("div");
    const input = document.createElement("input");
    expect(guard({ key: "\\", metaKey: true, ctrlKey: false, isComposing: false, target: div })).toBe(true);
    expect(guard({ key: "\\", metaKey: true, ctrlKey: false, isComposing: false, target: input })).toBe(false);
    expect(guard({ key: "\\", metaKey: true, ctrlKey: false, isComposing: true, target: div })).toBe(false);
  });
});
