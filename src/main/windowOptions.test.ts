import { describe, expect, it } from "vitest";
import * as module from "./windowOptions";

describe("platform window options", () => {
  it("uses hiddenInset and sidebar vibrancy only on macOS", () => {
    const options = (module as any).platformWindowOptions;
    expect(options).toBeTypeOf("function");
    expect(options("darwin", false)).toMatchObject({
      titleBarStyle: "hiddenInset",
      vibrancy: "sidebar",
      backgroundColor: "#00000000",
    });
    expect(options("win32", false).titleBarStyle).toBeUndefined();
    expect(options("linux", false).titleBarStyle).toBeUndefined();
  });

  it("requests Mica on Windows and an opaque fallback on Linux", () => {
    const options = (module as any).platformWindowOptions;
    expect(options).toBeTypeOf("function");
    expect(options("win32", false)).toMatchObject({ backgroundMaterial: "mica" });
    expect(options("linux", true)).toMatchObject({ backgroundColor: "#181818" });
  });
});
