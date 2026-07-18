// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isDarwinRenderer } from "./surfaces";

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");

afterEach(() => {
  Reflect.deleteProperty(window, "api");
  if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
});

describe("isDarwinRenderer", () => {
  it("does not treat a mac-like browser navigator as Electron Darwin", () => {
    Reflect.deleteProperty(window, "api");
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });

    expect(isDarwinRenderer()).toBe(false);
  });

  it("returns true only for an explicitly injected Electron Darwin platform", () => {
    window.api = { platform: "darwin" } as Window["api"];

    expect(isDarwinRenderer()).toBe(true);
  });

  it("returns false for an explicitly injected non-Darwin platform", () => {
    window.api = { platform: "win32" } as Window["api"];

    expect(isDarwinRenderer()).toBe(false);
  });
});
