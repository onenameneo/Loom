import { describe, expect, it } from "vitest";
import { acceptTraceSnapshot } from "./traceState";

describe("acceptTraceSnapshot", () => {
  it("keeps the newest snapshot for the focused node", () => {
    const current = { nodeId: "node-1", sequence: 4, records: [{ turnId: "turn-1" }] };

    expect(acceptTraceSnapshot(current, { nodeId: "node-1", sequence: 3, records: [] }, "node-1")).toBe(current);
    expect(acceptTraceSnapshot(current, { nodeId: "node-2", sequence: 9, records: [] }, "node-1")).toBe(current);
    expect(acceptTraceSnapshot(current, { nodeId: "node-1", sequence: 5, records: [] }, "node-1")).toEqual({ nodeId: "node-1", sequence: 5, records: [] });
  });

  it("treats newer trace snapshots as authoritative so truncated entries stay evicted", () => {
    const current = {
      nodeId: "node-1",
      sequence: 1,
      records: [{
        turnId: "turn-1",
        state: "running",
        operation: "send",
        entries: [
          { sequence: 1, kind: "event", payload: { type: "message_update" } },
          { sequence: 2, kind: "event", payload: { type: "message_update" } },
          { sequence: 3, kind: "event", payload: { type: "message_update" } },
        ],
      }],
    };

    expect(acceptTraceSnapshot(current, {
      nodeId: "node-1",
      sequence: 4,
      records: [{
        turnId: "turn-1",
        state: "running",
        operation: "send",
        truncated: true,
        entries: [{ sequence: 4, kind: "event", payload: { type: "message_update" } }],
      }],
    }, "node-1")).toEqual({
      nodeId: "node-1",
      sequence: 4,
      records: [{
        turnId: "turn-1",
        state: "running",
        operation: "send",
        truncated: true,
        entries: [{ sequence: 4, kind: "event", payload: { type: "message_update" } }],
      }],
    });
  });
});
