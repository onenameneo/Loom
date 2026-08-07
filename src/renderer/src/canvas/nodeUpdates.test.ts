// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { publishNodeUpdate, subscribeNodeUpdates } from "./nodeUpdates";

describe("node update synchronization", () => {
  it("broadcasts a node metadata update and unregisters cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNodeUpdates(listener);

    publishNodeUpdate({ id: "node-1", sessionId: "session-1", color: "blue", title: "策略研究" });
    expect(listener).toHaveBeenCalledWith({ id: "node-1", sessionId: "session-1", color: "blue", title: "策略研究" });

    unsubscribe();
    publishNodeUpdate({ id: "node-1", sessionId: "session-1", color: "green" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
