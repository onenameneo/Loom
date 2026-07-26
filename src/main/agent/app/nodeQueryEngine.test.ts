import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EngineHandle, EventSinkPort, LlmEnginePort } from "../ports";
import { createNodeQueryEngine } from "./nodeQueryEngine";
import { createTurnRunner } from "./turnRunner";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function eventSink(): EventSinkPort {
  return { emit: vi.fn() };
}

function engine(handle: EngineHandle): LlmEnginePort {
  return { ensure: vi.fn(async () => handle), peek: vi.fn(() => handle), drop: vi.fn(), invalidateAll: vi.fn(), listModels: vi.fn(async () => []) };
}

describe("NodeQueryEngine", () => {
  it("acquires before preparation and leaves a busy request unchanged", async () => {
    const gate = deferred();
    const messages: AgentMessage[] = [];
    const handle: EngineHandle = {
      messages,
      prompt: vi.fn(async () => gate.promise),
      continue: vi.fn(), abort: vi.fn(), reset: vi.fn(), syncMessages: vi.fn(),
    };
    const queries = createNodeQueryEngine({ engine: engine(handle), turns: createTurnRunner({ events: eventSink() }) });
    const prepareFirst = vi.fn(() => ({ kind: "prompt" as const, message: { role: "user", content: "one" } as AgentMessage }));
    const prepareSecond = vi.fn(() => ({ kind: "continue" as const }));

    const first = queries.run({ nodeId: "n1", operation: "send", prepare: prepareFirst, finalize: vi.fn() });
    await vi.waitFor(() => expect(prepareFirst).toHaveBeenCalledOnce());
    const second = await queries.run({ nodeId: "n1", operation: "regenerate", prepare: prepareSecond, finalize: vi.fn() });
    expect(second.result).toEqual({ ok: false, reason: "node_busy" });
    expect(prepareSecond).not.toHaveBeenCalled();
    gate.resolve();
    await first;
  });

  it("invokes pi once and finalizes its delta after a successful query", async () => {
    const messages: AgentMessage[] = [];
    const user = { role: "user", content: "hello" } as AgentMessage;
    const handle: EngineHandle = {
      messages,
      prompt: vi.fn(async (message) => { messages.push(message, { role: "assistant", content: "done" } as unknown as AgentMessage); }),
      continue: vi.fn(), abort: vi.fn(), reset: vi.fn(), syncMessages: vi.fn(),
    };
    const finalize = vi.fn();
    const queries = createNodeQueryEngine({ engine: engine(handle), turns: createTurnRunner({ events: eventSink() }) });

    const output = await queries.run({ nodeId: "n1", operation: "send", prepare: () => ({ kind: "prompt", message: user }), finalize });
    expect(output.result.ok).toBe(true);
    expect(handle.prompt).toHaveBeenCalledWith(user);
    expect(finalize).toHaveBeenCalledWith(handle, 0);
  });

  it("finalizes partial output after abort but not after invalidation", async () => {
    const gate = deferred();
    const messages: AgentMessage[] = [];
    const handle: EngineHandle = {
      messages,
      prompt: vi.fn(async () => { messages.push({ role: "assistant", content: "partial" } as unknown as AgentMessage); await gate.promise; }),
      continue: vi.fn(), abort: vi.fn(), reset: vi.fn(), syncMessages: vi.fn(),
    };
    const queries = createNodeQueryEngine({ engine: engine(handle), turns: createTurnRunner({ events: eventSink() }) });
    const abortFinalize = vi.fn();
    const aborted = queries.run({ nodeId: "n1", operation: "send", prepare: () => ({ kind: "prompt", message: { role: "user", content: "go" } as AgentMessage }), finalize: abortFinalize });
    await vi.waitFor(() => expect(handle.prompt).toHaveBeenCalledOnce());
    queries.abort("n1");
    gate.resolve();
    await expect(aborted).resolves.toMatchObject({ result: { ok: false, reason: "aborted" } });
    expect(abortFinalize).toHaveBeenCalledOnce();

    const gate2 = deferred();
    handle.prompt = vi.fn(async () => gate2.promise);
    const staleFinalize = vi.fn();
    const stale = queries.run({ nodeId: "n1", operation: "send", prepare: () => ({ kind: "prompt", message: { role: "user", content: "again" } as AgentMessage }), finalize: staleFinalize });
    await vi.waitFor(() => expect(handle.prompt).toHaveBeenCalledOnce());
    queries.invalidate("n1");
    gate2.resolve();
    await expect(stale).resolves.toMatchObject({ result: { ok: false, reason: "stale" } });
    expect(staleFinalize).not.toHaveBeenCalled();
  });
});
