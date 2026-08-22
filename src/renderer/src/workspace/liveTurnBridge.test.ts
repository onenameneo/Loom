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

    const stop = connectLiveTurnBridge(api, useWorkspaceStore, { scheduleFrame: (flush) => queueMicrotask(flush) });
    listener?.({ type: "upsert", snapshot: snapshot(3) });
    resolveInitial?.([snapshot(2)]);
    await initial;
    await Promise.resolve();

    expect(calls).toEqual(["subscribe", "snapshot"]);
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.revision).toBe(3);
    stop();
  });

  it("requests a current snapshot after a sequence gap", async () => {
    resetWorkspaceStore();
    const snapshotValue = snapshot(4);
    snapshotValue.assistantText = "recovered";
    snapshotValue.contentParts = [{ partId: "part-1", kind: "text", text: "recovered", sequence: 1 }];
    snapshotValue.contentSequence = 1;
    const listener = vi.fn<(event: LiveTurnEvent) => void>();
    const api = {
      onLiveTurn: (next: (event: LiveTurnEvent) => void) => { listener.mockImplementation(next); return vi.fn(); },
      liveTurns: vi.fn(async () => [snapshot(1)]),
      liveTurn: vi.fn(async () => snapshotValue),
    };

    const stop = connectLiveTurnBridge(api, useWorkspaceStore, { scheduleFrame: (flush) => queueMicrotask(flush) });
    await Promise.resolve();
    listener({
      type: "patch",
      nodeId: "node-a",
      sessionId: "session-a",
      turnId: "turn-a",
      operation: "send",
      state: "running",
      revision: 3,
      sequenceStart: 2,
      sequenceEnd: 2,
      sequence: 2,
      parts: [{ partId: "part-2", kind: "text", delta: "lost", sequence: 2 }],
    });
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(api.liveTurn).toHaveBeenCalledWith("node-a");
      expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.assistantText).toBe("recovered");
    });
    stop();
  });

  it("coalesces contiguous patches before one workspace-store submission", async () => {
    resetWorkspaceStore();
    let listener: ((event: LiveTurnEvent) => void) | undefined;
    let flush: (() => void) | undefined;
    const calls: LiveTurnEvent[] = [];
    const base = snapshot(1);
    base.assistantText = "a";
    base.contentParts = [{ partId: "part-1", kind: "text", text: "a", sequence: 1 }];
    base.contentSequence = 1;
    const api = {
      onLiveTurn: (next: (event: LiveTurnEvent) => void) => { listener = next; return vi.fn(); },
      liveTurns: vi.fn(async () => [base]),
    };
    const store = {
      getState: () => ({
        applyLiveTurn: (event: LiveTurnEvent) => {
          calls.push(event);
          return useWorkspaceStore.getState().applyLiveTurn(event);
        },
      }),
    } as any;

    const stop = connectLiveTurnBridge(api, store, { scheduleFrame: (next) => { flush = next; } });
    await Promise.resolve();
    listener?.({ type: "patch", nodeId: "node-a", sessionId: "session-a", turnId: "turn-a", operation: "send", state: "running", revision: 2, sequenceStart: 2, sequenceEnd: 2, sequence: 2, parts: [{ partId: "part-1", kind: "text", delta: "b", sequence: 2 }] });
    listener?.({ type: "patch", nodeId: "node-a", sessionId: "session-a", turnId: "turn-a", operation: "send", state: "running", revision: 3, sequenceStart: 3, sequenceEnd: 3, sequence: 3, parts: [{ partId: "part-1", kind: "text", delta: "c", sequence: 3 }] });

    expect(calls).toHaveLength(1);
    flush?.();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ type: "patch", revision: 3, sequenceStart: 2, sequenceEnd: 3, parts: [{ delta: "b" }, { delta: "c" }] });
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.assistantText).toBe("abc");
    stop();
  });

  it("keeps the final patch visible for one render frame before removing the live turn", async () => {
    resetWorkspaceStore();
    let listener: ((event: LiveTurnEvent) => void) | undefined;
    const frames: Array<() => void> = [];
    const base = snapshot(1);
    base.assistantText = "before";
    base.contentParts = [{ partId: "part-1", kind: "text", text: "before", sequence: 1 }];
    base.contentSequence = 1;
    const api = {
      onLiveTurn: (next: (event: LiveTurnEvent) => void) => { listener = next; return vi.fn(); },
      liveTurns: vi.fn(async () => [base]),
    };

    const stop = connectLiveTurnBridge(api, useWorkspaceStore, { scheduleFrame: (next) => { frames.push(next); } });
    await Promise.resolve();
    listener?.({
      type: "patch",
      nodeId: "node-a",
      sessionId: "session-a",
      turnId: "turn-a",
      operation: "send",
      state: "running",
      revision: 2,
      sequenceStart: 2,
      sequenceEnd: 2,
      sequence: 2,
      parts: [{ partId: "part-1", kind: "text", delta: "tail", sequence: 2 }],
    });
    listener?.({ type: "remove", nodeId: "node-a", revision: 3 });

    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.assistantText).toBe("beforetail");
    frames.shift()?.();
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]?.assistantText).toBe("beforetail");
    frames.shift()?.();
    expect(useWorkspaceStore.getState().turnsByNodeId["node-a"]).toBeUndefined();
    stop();
  });
});
