import { describe, expect, it, vi } from "vitest";
import { createTurnRunner } from "./turnRunner";
import { createNodeRuntimeStore, type NodeRuntimeStore } from "./nodeRuntime";
import type { CanvasNode } from "./session";
import type { EngineHandle, EventSinkPort } from "../ports";

function engineHandle(): EngineHandle {
  return { messages: [], prompt: vi.fn(), continue: vi.fn(), abort: vi.fn(), reset: vi.fn(), syncMessages: vi.fn() };
}

function eventSink() {
  const events: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) };
  return { sink, events };
}

function node(id: string): CanvasNode {
  return { id, sessionId: "session-a", projectId: "project-a", title: id, messages: [], messageMeta: [] } as CanvasNode;
}

function makeRuntime(nodeIds: string[]): NodeRuntimeStore {
  const runtime = createNodeRuntimeStore({ publishLive: vi.fn() });
  for (const id of nodeIds) runtime.set(id, { node: node(id), pendingSkillIds: [] });
  return runtime;
}

describe("createTurnRunner", () => {
  it("rejects a conflicting same-node acquisition", () => {
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    expect(runner.acquire("n1", "send").ok).toBe(true);
    expect(runner.acquire("n1", "regenerate")).toEqual({ ok: false, reason: "node_busy" });
  });

  it("allows different nodes to acquire independently", () => {
    const runtime = makeRuntime(["a", "b"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    expect(runner.acquire("a", "send").ok).toBe(true);
    expect(runner.acquire("b", "send").ok).toBe(true);
  });

  it("emits running and completed when a lease settles successfully", () => {
    const { sink, events } = eventSink();
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: sink, runtime });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    expect(runner.settle(acquired.turn)).toMatchObject({ ok: true });
    expect(events.map((event) => (event.payload as any)?.state)).toEqual(["running", "completed"]);
  });

  it("aborts the engine handle and reports aborted when the lease settles", () => {
    const { sink, events } = eventSink();
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: sink, runtime });
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
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: sink, runtime });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    runner.invalidate("n1");
    expect(runner.settle(acquired.turn)).toEqual({ ok: false, reason: "stale" });
    expect(events.map((event) => (event.payload as any)?.state)).not.toContain("completed");
  });

  it("records approval transitions as approval trace entries", () => {
    const runtime = makeRuntime(["n1"]);
    const { sink, events } = eventSink();
    const runner = createTurnRunner({ events: sink, runtime, now: () => 1 });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    acquired.turn.setAwaitingApproval({ requestId: "approval-1", toolName: "shell", toolCallId: "call-1" });

    expect(events.at(-1)?.payload).toMatchObject({ state: "awaiting_approval", approval: { requestId: "approval-1", toolName: "shell" } });
  });
});

describe("turnRunner over NodeRuntime store (phase 2 regressions)", () => {
  it("keeps a late finalize a no-op after a generation bump and settles stale", () => {
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");
    const turn = acquired.turn;
    const handle = engineHandle();
    turn.setAbortHandle(handle);

    runner.invalidate("n1"); // generation bump → 旧 active turn stale + 底层 handle abort

    expect(handle.abort).toHaveBeenCalledOnce();
    expect(runner.settle(turn)).toEqual({ ok: false, reason: "stale" });
    expect(runtime.get("n1")?.activeTurn).toBeUndefined();
  });

  it("settles successfully when generation is unchanged", () => {
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    expect(runner.settle(acquired.turn)).toMatchObject({ ok: true });
    expect(runtime.get("n1")?.activeTurn).toBeUndefined();
    expect(runtime.get("n1")?.generation).toBe(1);
  });

  it("removes the tombstone record after an in-flight turn settles", () => {
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    const acquired = runner.acquire("n1", "send");
    if (!acquired.ok) throw new Error("expected turn");

    runtime.markDisposed("n1"); // 活跃 turn → tombstone 保留
    expect(runtime.get("n1")?.disposed).toBe(true);

    expect(runner.settle(acquired.turn)).toEqual({ ok: false, reason: "stale" });
    expect(runtime.get("n1")).toBeUndefined(); // settle 后清理 tombstone
  });

  it("removes the record immediately when an idle node is disposed", () => {
    const runtime = makeRuntime(["n1"]);
    runtime.markDisposed("n1");
    expect(runtime.get("n1")).toBeUndefined();
  });

  it("lets a new turn acquire a monotonic generation after invalidation", () => {
    const runtime = makeRuntime(["n1"]);
    const runner = createTurnRunner({ events: eventSink().sink, runtime });
    const first = runner.acquire("n1", "send");
    if (!first.ok) throw new Error("expected turn");
    expect(runtime.get("n1")?.generation).toBe(1);
    runner.settle(first.turn);

    runner.invalidate("n1"); // 即使 turn 已 settle 也递增 epoch
    const second = runner.acquire("n1", "send");
    if (!second.ok) throw new Error("expected turn");
    expect(runtime.get("n1")?.generation).toBe(3);
  });
});
