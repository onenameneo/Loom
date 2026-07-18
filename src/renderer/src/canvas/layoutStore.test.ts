import { describe, expect, it, vi } from "vitest";
import * as module from "./layoutStore";

const first = { x: 10, y: 20, width: 360, height: 260 };
const latest = { x: 90, y: 70, width: 400, height: 300 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("CanvasLayoutStore", () => {
  it("keeps a newer revision when an older response finishes and then saves the latest layout", async () => {
    const one = deferred<{ ok: true; updatedIds: string[] }>();
    const two = deferred<{ ok: true; updatedIds: string[] }>();
    const api = { updateLayouts: vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise) };
    const Store = (module as any).CanvasLayoutStore;
    expect(Store).toBeTypeOf("function");
    const store = new Store(api);

    store.enqueue("ws", "n1", first);
    await tick();
    store.enqueue("ws", "n1", latest);
    one.resolve({ ok: true, updatedIds: ["n1"] });
    await tick();

    expect(store.getDirty("ws", "n1")).toEqual(latest);
    expect(api.updateLayouts).toHaveBeenLastCalledWith([{ id: "n1", layout: latest }]);

    two.resolve({ ok: true, updatedIds: ["n1"] });
    await tick();
    expect(store.getDirty("ws", "n1")).toBeUndefined();
  });

  it("retains failed layouts until retry succeeds", async () => {
    const api = {
      updateLayouts: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, updatedIds: [], reason: "storage" })
        .mockResolvedValueOnce({ ok: true, updatedIds: ["n1"] }),
    };
    const Store = (module as any).CanvasLayoutStore;
    expect(Store).toBeTypeOf("function");
    const store = new Store(api);

    store.enqueue("ws", "n1", first);
    await tick();
    expect(store.getDirty("ws", "n1")).toEqual(first);

    await store.retry("ws");
    expect(store.getDirty("ws", "n1")).toBeUndefined();
  });

  it("removes deleted nodes from the dirty set", async () => {
    const pending = deferred<{ ok: true; updatedIds: string[] }>();
    const api = { updateLayouts: vi.fn().mockReturnValue(pending.promise) };
    const Store = (module as any).CanvasLayoutStore;
    expect(Store).toBeTypeOf("function");
    const store = new Store(api);

    store.enqueue("ws", "n1", first);
    await tick();
    store.remove("ws", ["n1"]);

    expect(store.getDirty("ws", "n1")).toBeUndefined();
  });

  it("queues a tidy operation as one batch", async () => {
    const api = { updateLayouts: vi.fn().mockResolvedValue({ ok: true, updatedIds: ["n1", "n2"] }) };
    const Store = (module as any).CanvasLayoutStore;
    const store = new Store(api);

    store.enqueueMany?.("ws", [
      { id: "n1", layout: first },
      { id: "n2", layout: latest },
    ]);
    await tick();

    expect(api.updateLayouts).toHaveBeenCalledTimes(1);
    expect(api.updateLayouts).toHaveBeenCalledWith([
      { id: "n1", layout: first },
      { id: "n2", layout: latest },
    ]);
  });
});
