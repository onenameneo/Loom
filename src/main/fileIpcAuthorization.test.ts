import { describe, expect, it } from "vitest";
import { assertRendererSender } from "./fileIpcAuthorization";

describe("file IPC renderer authorization", () => {
  it("accepts only the live renderer WebContents", () => {
    const contents = {};
    const rendererWindow = { webContents: contents, isDestroyed: () => false };
    expect(() => assertRendererSender({ sender: contents }, rendererWindow)).not.toThrow();
    expect(() => assertRendererSender({ sender: {} }, rendererWindow)).toThrow(/unauthorized/i);
    expect(() => assertRendererSender({ sender: contents }, { ...rendererWindow, isDestroyed: () => true })).toThrow(/unauthorized/i);
  });
});
