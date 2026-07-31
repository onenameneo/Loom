import { describe, expect, it, vi } from "vitest";
import { markRendererNotReady, markRendererReady, sendToWindow } from "./ipcSafeSend";

function windowLike(
  frameSend: (...args: unknown[]) => void,
  opts?: { winDestroyed?: boolean; contentsDestroyed?: boolean; frameDestroyed?: boolean; frameDetached?: boolean },
) {
  return {
    isDestroyed: () => Boolean(opts?.winDestroyed),
    webContents: {
      isDestroyed: () => Boolean(opts?.contentsDestroyed),
      send: () => {
        throw new Error("webContents.send should not be used");
      },
      mainFrame: {
        isDestroyed: () => Boolean(opts?.frameDestroyed),
        detached: Boolean(opts?.frameDetached),
        send: frameSend,
      },
    },
  };
}

describe("sendToWindow", () => {
  it("drops events when the BrowserWindow, webContents, or main frame is already destroyed", () => {
    const send = vi.fn(() => {
      throw new Error("send should not be called");
    });

    expect(sendToWindow(() => null, "monitor:event")).toBe(false);
    expect(sendToWindow(() => windowLike(send, { winDestroyed: true }) as never, "monitor:event")).toBe(false);
    expect(sendToWindow(() => windowLike(send, { contentsDestroyed: true }) as never, "monitor:event")).toBe(false);
    expect(sendToWindow(() => windowLike(send, { frameDestroyed: true }) as never, "monitor:event")).toBe(false);
    expect(sendToWindow(() => windowLike(send, { frameDetached: true }) as never, "monitor:event")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows renderer frame disposal races but rethrows unknown send errors", () => {
    const disposed = windowLike(() => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    }) as never;
    const unknown = windowLike(() => {
      throw new Error("boom");
    }) as never;

    markRendererReady(disposed);
    markRendererReady(unknown);

    expect(sendToWindow(() => disposed, "monitor:event")).toBe(false);
    expect(() => sendToWindow(() => unknown, "monitor:event")).toThrow("boom");
  });

  it("sends the payload when the renderer is live", () => {
    const send = vi.fn();
    const win = windowLike(send) as never;

    markRendererReady(win);

    expect(sendToWindow(() => win, "monitor:event", { type: "snapshot" })).toBe(true);
    expect(send).toHaveBeenCalledWith("monitor:event", { type: "snapshot" });
  });

  it("gates delivery on renderer readiness", () => {
    const send = vi.fn();
    const win = windowLike(send) as never;

    expect(sendToWindow(() => win, "canvas:event", { type: "token" })).toBe(false);
    expect(send).not.toHaveBeenCalled();

    markRendererReady(win);
    expect(sendToWindow(() => win, "canvas:event", { type: "token" })).toBe(true);

    markRendererNotReady(win);
    expect(sendToWindow(() => win, "canvas:event", { type: "token" })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not mark a destroyed or detached frame as ready", () => {
    const send = vi.fn();
    const destroyed = windowLike(send, { frameDestroyed: true }) as never;
    const detached = windowLike(send, { frameDetached: true }) as never;

    expect(markRendererReady(destroyed)).toBe(false);
    expect(markRendererReady(detached)).toBe(false);
    expect(sendToWindow(() => destroyed, "canvas:event")).toBe(false);
    expect(sendToWindow(() => detached, "canvas:event")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
