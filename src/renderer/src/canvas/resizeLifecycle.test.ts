import { describe, expect, it, vi } from "vitest";
import { finishResizeInteraction } from "./resizeLifecycle";
import { ResizeSession } from "./resizeSession";

describe("finishResizeInteraction", () => {
  it("applies and enqueues one valid finish while rejecting a duplicate token", () => {
    const session = new ResizeSession();
    const token = session.start("n1");
    const initial = { x: 20, y: 30, width: 420, height: 320 };
    const final = { ...initial, width: 480, height: 360 };
    const apply = vi.fn();
    const enqueue = vi.fn();

    session.update(token, "n1", initial);

    expect(
      finishResizeInteraction({ session, token, nodeId: "n1", layout: final, apply, enqueue }),
    ).toEqual(final);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith("n1", final);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith("n1", final);
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0]);

    expect(
      finishResizeInteraction({ session, token, nodeId: "n1", layout: final, apply, enqueue }),
    ).toBeNull();
    expect(apply).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
