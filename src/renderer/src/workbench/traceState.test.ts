import { describe, expect, it } from "vitest";
import { acceptTraceSnapshot } from "./traceState";

describe("acceptTraceSnapshot", () => {
  it("keeps the newest snapshot for the focused node", () => {
    const current = { nodeId: "node-1", sequence: 4, records: [{ turnId: "turn-1" }] };

    expect(acceptTraceSnapshot(current, { nodeId: "node-1", sequence: 3, records: [] }, "node-1")).toBe(current);
    expect(acceptTraceSnapshot(current, { nodeId: "node-2", sequence: 9, records: [] }, "node-1")).toBe(current);
    expect(acceptTraceSnapshot(current, { nodeId: "node-1", sequence: 5, records: [] }, "node-1")).toEqual({ nodeId: "node-1", sequence: 5, records: [] });
  });

  it("merges newer partial trace records instead of dropping earlier entries", () => {
    const current = {
      nodeId: "node-1",
      sequence: 1,
      records: [{
        turnId: "turn-1",
        state: "running",
        operation: "send",
        entries: [{ sequence: 1, kind: "request", payload: { model: "gpt-5" } }],
      }],
    };

    expect(acceptTraceSnapshot(current, {
      nodeId: "node-1",
      sequence: 2,
      records: [{
        turnId: "turn-1",
        state: "completed",
        operation: "send",
        entries: [{ sequence: 2, kind: "response", payload: { message: "done" } }],
      }],
    }, "node-1")).toEqual({
      nodeId: "node-1",
      sequence: 2,
      records: [{
        turnId: "turn-1",
        state: "completed",
        operation: "send",
        entries: [
          { sequence: 1, kind: "request", payload: { model: "gpt-5" } },
          { sequence: 2, kind: "response", payload: { message: "done" } },
        ],
      }],
    });
  });
});
