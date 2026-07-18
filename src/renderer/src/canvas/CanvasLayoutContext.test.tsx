// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLayoutProvider, useCanvasLayoutPersistence, useCanvasLayoutStore } from "./CanvasLayoutContext";

const layout = { x: 10, y: 20, width: 360, height: 260 };

function PersistenceHarness() {
  const store = useCanvasLayoutStore();
  const persistence = useCanvasLayoutPersistence("ws");
  return (
    <>
      <button type="button" onClick={() => store.enqueue("ws", "n1", layout)}>
        保存布局
      </button>
      <button type="button" onClick={() => void persistence.retry()}>
        重试队列
      </button>
      <output aria-label="持久化状态">{`${persistence.status}:${persistence.error ?? "none"}`}</output>
      <output aria-label="dirty 状态">{store.getDirty("ws", "n1") ? "dirty" : "clean"}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "api");
  vi.restoreAllMocks();
});

describe("CanvasLayoutProvider persistence exposure", () => {
  it("exposes storage failure, retries the queue, and clears failure only after success", async () => {
    const updateLayouts = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, updatedIds: [], reason: "storage" })
      .mockResolvedValueOnce({ ok: true, updatedIds: ["n1"] });
    window.api = { canvas: { updateLayouts } } as unknown as Window["api"];
    render(
      <CanvasLayoutProvider>
        <PersistenceHarness />
      </CanvasLayoutProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存布局" }));
    await waitFor(() => expect(screen.getByLabelText("持久化状态").textContent).toBe("error:storage"));
    expect(screen.getByLabelText("dirty 状态").textContent).toBe("dirty");

    fireEvent.click(screen.getByRole("button", { name: "重试队列" }));

    await waitFor(() => expect(screen.getByLabelText("持久化状态").textContent).toBe("idle:none"));
    expect(updateLayouts).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("dirty 状态").textContent).toBe("clean");
  });
});
