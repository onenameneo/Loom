import { describe, expect, it, vi } from "vitest";
import { createTurnRunner } from "./turnRunner";
import type { EngineHandle, EventSinkPort } from "../ports";

function engineHandle(): EngineHandle {
  return { messages: [], prompt: vi.fn(), continue: vi.fn(), abort: vi.fn(), reset: vi.fn(), syncMessages: vi.fn() };
}

function eventSink() {
  const events: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) };
  return { sink, events };
}

describe("createTurnRunner", () => {
  it("rejects a conflicting same-node acquisition", () => {
    const runner = createTurnRunner({ events: eventSink().sink });
    expect(runner.acquire("n1", "send").ok).toBe(true);
    expect(runner.acquire("n1", "regenerate")).toEqual({ ok: false, reason: "node_busy" });
  });

  it("allows different nodes to acquire independently", () => {
    const runner = createTurnRunner({ events: eventSink().sink });
    expect(runner.acquire("a", "send").ok).toBe(true);
    expect(runner.acquire("b", "send").ok).toBe(true);
  });

  it("emits running and completed when a lease settles successfully", () => {
    const { sink, events } = eventSink();
    const runner = createTurnRunner({ events: sink });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    expect(runner.settle(acquired.turn)).toMatchObject({ ok: true });
    expect(events.map((event) => (event.payload as any)?.state)).toEqual(["running", "completed"]);
  });

  it("aborts the engine handle and reports aborted when the lease settles", () => {
    const { sink, events } = eventSink();
    const runner = createTurnRunner({ events: sink });
    const handle = engineHandle();
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");
    acquired.turn.setAbortHandle(handle);

    runner.abort("n1");
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(runner.settle(acquired.turn)).toEqual({ ok: false, reason: "aborted" });
    expect(events.at(-1)).toMatchObject({ payload: { state: "aborted" } });
  });

  it("makes an invalidated lease stale without a success event", () => {
    const { sink, events } = eventSink();
    const runner = createTurnRunner({ events: sink });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    runner.invalidate("n1");
    expect(runner.settle(acquired.turn)).toEqual({ ok: false, reason: "stale" });
    expect(events.map((event) => (event.payload as any)?.state)).not.toContain("completed");
  });
});
