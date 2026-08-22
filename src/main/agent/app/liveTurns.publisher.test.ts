import { describe, expect, it } from "vitest";
import { createLiveTurnPublisher, type LiveTurnPatch } from "./liveTurns";

const patch = (revision: number, delta: string): LiveTurnPatch => ({
  type: "patch",
  nodeId: "node-1",
  sessionId: "session-1",
  turnId: "turn-1",
  operation: "send",
  state: "running",
  revision,
  sequenceStart: revision,
  sequenceEnd: revision,
  sequence: revision,
  parts: [{ partId: "part-1", kind: "text", delta, sequence: 1 }],
});

describe("live-turn publisher", () => {
  it("coalesces patches scheduled in the same frame", () => {
    let flush: (() => void) | undefined;
    const received: unknown[] = [];
    const publisher = createLiveTurnPublisher({ schedule: (next) => { flush = next; } });
    publisher.subscribe((event) => received.push(event));

    publisher.publish(patch(1, "a"));
    publisher.publish(patch(2, "b"));

    expect(received).toEqual([]);
    flush?.();
    expect(received).toEqual([expect.objectContaining({ type: "patch", revision: 2, sequenceStart: 1, sequenceEnd: 2, sequence: 2, parts: [
      expect.objectContaining({ delta: "ab" }),
    ] })]);
  });
});
