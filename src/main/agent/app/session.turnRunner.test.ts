import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createAgentSession } from "./session";
import type { EngineHandle, EventSinkPort, LlmEnginePort, NodeInit } from "../ports";
import type { NodeLayout, NodeRecord, PersistedMessage, SessionRecord, Settings, Store, Workspace } from "../../store/store";
import { DEFAULT_SETTINGS } from "../../store/store";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class MemoryStore implements Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  workspaces: Workspace[] = [{ id: "ws", name: "ws", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }];
  sessions: SessionRecord[] = [
    { id: "sess", projectId: "ws", title: "Session", createdAt: 1, updatedAt: 1, order: 0 },
    { id: "sess2", projectId: "ws", title: "Second", createdAt: 1, updatedAt: 1, order: 1 },
  ];
  nodes = new Map<string, NodeRecord>();

  constructor(messages: AgentMessage[] = []) {
    this.nodes.set("n1", {
      id: "n1",
      sessionId: "sess",
      workspaceId: "ws",
      title: "Node",
      mountAncestors: false,
      messages: messages.map((content, seq) => ({ id: `m${seq}`, seq, role: String((content as any).role), content })),
    });
    this.nodes.set("n2", {
      id: "n2",
      sessionId: "sess2",
      workspaceId: "ws",
      title: "Second",
      mountAncestors: false,
      messages: [],
    });
  }

  getSettings() { return this.settings; }
  patchSettings() { return this.settings; }
  getApiKeyEnc() { return undefined; }
  setApiKeyEnc() {}
  listWorkspaces() { return this.workspaces; }
  createWorkspace() { return this.workspaces[0]; }
  renameWorkspace() {}
  deleteWorkspace() {}
  setPinned() {}
  listSessions(projectId: string) { return this.sessions.filter((session) => session.projectId === projectId); }
  getSession(id: string) { return this.sessions.find((session) => session.id === id); }
  ensureDefaultSession(projectId: string) { return this.listSessions(projectId)[0]; }
  createSession() { return this.sessions[0]; }
  renameSession() {}
  deleteSession() {}
  listNodes(sessionId: string) { return [...this.nodes.values()].filter((n) => n.sessionId === sessionId); }
  getNode(id: string) { return this.nodes.get(id); }
  createNode(input: { sessionId?: string; workspaceId?: string; title: string }): NodeRecord {
    const session = (input.sessionId ? this.getSession(input.sessionId) : this.ensureDefaultSession(input.workspaceId ?? "ws")) ?? this.sessions[0];
    const node: NodeRecord = {
      id: `n${this.nodes.size + 1}`,
      sessionId: session.id,
      workspaceId: session.projectId,
      title: input.title,
      mountAncestors: false,
      messages: [],
    };
    this.nodes.set(node.id, node);
    return node;
  }
  updateNode() {}
  updateNodeLayout(_id: string, _layout: NodeLayout) { return true; }
  updateNodeLayouts(items: Array<{ id: string; layout: NodeLayout }>) { return items.map((i) => i.id); }
  deleteNode(id: string) { this.nodes.delete(id); }
  appendMessages(nodeId: string, msgs: PersistedMessage[]) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    for (const msg of msgs) {
      node.messages.push({ ...msg, seq: node.messages.length });
    }
  }
  deleteMessagesFrom(nodeId: string, seq: number) {
    const node = this.nodes.get(nodeId);
    if (node) node.messages = node.messages.slice(0, seq);
  }
  listMessages(nodeId: string) { return this.nodes.get(nodeId)?.messages ?? []; }
}

function events() {
  const items: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => items.push({ nodeId, type, payload }) };
  return { sink, items };
}

function createEngine(handle: EngineHandle): LlmEnginePort {
  return {
    ensure: async () => handle,
    peek: () => handle,
    drop: vi.fn(),
    invalidateAll: vi.fn(),
    listModels: async () => [],
  };
}

function createHandle(messages: AgentMessage[], prompt: EngineHandle["prompt"]): EngineHandle {
  return {
    get messages() {
      return messages;
    },
    prompt,
    continue: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    syncMessages: (next) => {
      messages.splice(0, messages.length, ...next);
    },
  };
}

describe("createAgentSession turn runner integration", () => {
  it("rejects a busy same-node send before appending another user message", async () => {
    const store = new MemoryStore();
    const eventLog = events();
    const gate = deferred();
    const engineMessages: AgentMessage[] = [];
    const handle = createHandle(engineMessages, vi.fn(async (msg) => {
      engineMessages.push(msg);
      await gate.promise;
      engineMessages.push({ role: "assistant", content: "done" } as unknown as AgentMessage);
    }));
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(handle),
    });

    const first = session.send({ nodeId: "n1", text: "first" });
    await vi.waitFor(() => expect(store.listMessages("n1")).toHaveLength(1));
    const second = await session.send({ nodeId: "n1", text: "second" });

    expect(second).toEqual({ ok: false, reason: "node_busy" });
    expect(store.listMessages("n1").map((m) => (m.content as any).content)).toEqual(["first"]);
    gate.resolve();
    await expect(first).resolves.toEqual({ ok: true });
    expect(store.listMessages("n1").map((m) => (m.content as any).content)).toEqual(["first", "done"]);
  });

  it("aborts an active send and persists partial assistant output once", async () => {
    const store = new MemoryStore();
    const eventLog = events();
    const gate = deferred();
    const engineMessages: AgentMessage[] = [];
    const handle = createHandle(engineMessages, vi.fn(async (msg) => {
      engineMessages.push(msg);
      engineMessages.push({ role: "assistant", content: "partial" } as unknown as AgentMessage);
      await gate.promise;
    }));
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(handle),
    });

    const run = session.send({ nodeId: "n1", text: "go" });
    await vi.waitFor(() => expect(engineMessages).toHaveLength(2));
    expect(session.abort("n1")).toEqual({ ok: true });
    gate.resolve();

    await expect(run).resolves.toEqual({ ok: false, reason: "aborted" });
    expect(handle.abort).toHaveBeenCalledTimes(1);
    expect(store.listMessages("n1").map((m) => (m.content as any).content)).toEqual(["go", "partial"]);
  });

  it("invalidates an active turn when opening another session", async () => {
    const store = new MemoryStore();
    const eventLog = events();
    const gate = deferred();
    const engineMessages: AgentMessage[] = [];
    const handle = createHandle(engineMessages, vi.fn(async (msg) => {
      engineMessages.push(msg);
      await gate.promise;
      engineMessages.push({ role: "assistant", content: "late" } as unknown as AgentMessage);
    }));
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(handle),
    });

    session.open("sess");
    const run = session.send({ nodeId: "n1", text: "go" });
    await vi.waitFor(() => expect(store.listMessages("n1")).toHaveLength(1));

    session.open("sess2");
    gate.resolve();

    await expect(run).resolves.toEqual({ ok: false, reason: "stale" });
    expect(store.listMessages("n1").map((m) => (m.content as any).content)).toEqual(["go"]);
  });
});
