import { describe, expect, it } from "vitest";
import * as module from "./resizeSession";

const layout = { x: 20, y: 30, width: 420, height: 320 };

describe("ResizeSession", () => {
  it("finishes with the last valid resize layout", () => {
    const Session = (module as any).ResizeSession;
    expect(Session).toBeTypeOf("function");
    const session = new Session();
    const token = session.start("n1");

    expect(session.update(token, "n1", layout)).toEqual(layout);
    expect(session.finish(token, "n1", { ...layout, width: 460 })).toEqual({
      ...layout,
      width: 460,
    });
    expect(session.isActive()).toBe(false);
  });

  it("cancels with the last valid layout and ignores late events", () => {
    const Session = (module as any).ResizeSession;
    expect(Session).toBeTypeOf("function");
    const session = new Session();
    const token = session.start("n1");
    session.update(token, "n1", layout);

    expect(session.cancel()).toEqual({ nodeId: "n1", layout });
    expect(session.update(token, "n1", { ...layout, width: 500 })).toBeUndefined();
    expect(session.finish(token, "n1", { ...layout, width: 500 })).toBeUndefined();
  });
});
