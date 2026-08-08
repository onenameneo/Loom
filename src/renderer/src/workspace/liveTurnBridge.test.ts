import { describe, expect, it, vi } from "vitest";
import type { LiveTurnEvent, LiveTurnSnapshot } from "../env";
import { resetWorkspaceStore, useWorkspaceStore } from "./store";
import { connectLiveTurnBridge } from "./liveTurnBridge";

const snapshot = (revision: number): LiveTurnSnapshot => ({
  nodeId: "node-a",
  sessionId: "session-a",
  turnId: "turn-a",
  operation: "send",
  state: "running",
  revision,
  assistantText: String(revision),
});

describe("live turn bridge", () => {
  it("keeps an event received before the initial snapshot when the snapshot is older", async () => {
    resetWorkspaceStore();
    const calls: string[] = [];
    let listener: ((event: LiveTurnEvent) => void) | undefined;
    let resolveInitial: ((items: LiveTurnSnapshot[]) => void) | undefined;
    const initial = new Promise<LiveTurnSnapshot[]>((resolve) => { resolveInitial = resolve; });
    const api = {
      onLiveTurn: vi.fn((next: (event: LiveTurnEvent) => void) => {
        calls.push("subscribe");
        listener = next;
        return vi.fn();
      }),
      liveTurns: vi.fn(() => {
        calls.push("snapshot");
        return initial;
      }),
    };

    const stop = connectLiveTurnBridge(api);
    listener?.({ type: "upsert", snapshot: snapshot(3) });
    resolveInitial?.([snapshot(2)]);
    await initial;
    await Promise.resolve();

    expect(calls).toEqual(["subscribe", "snapshot"]);
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.revision).toBe(3);
    stop();
  });
});
