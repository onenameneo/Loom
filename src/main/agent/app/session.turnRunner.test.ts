import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FrozenNodeContext } from "../core/context";
import { createAgentSession } from "./session";
import type { EngineFactory, EngineHandle, EventSinkPort, LlmEnginePort, NodeInit } from "../ports";
import type { AgentTool } from "../core/tool";
import { createLoomContextCheckpoint } from "../core/messages";
import type { BranchSource, NodeBranchPoint, NodeLayout, NodeRecord, PersistedMessage, SessionRecord, Settings, Store, Project } from "../../store/store";
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
  projects: Project[] = [{ id: "ws", name: "ws", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [] }];
  sessions: SessionRecord[] = [
    { id: "sess", projectId: "ws", title: "Session", createdAt: 1, updatedAt: 1, order: 0 },
    { id: "sess2", projectId: "ws", title: "Second", createdAt: 1, updatedAt: 1, order: 1 },
  ];
  nodes = new Map<string, NodeRecord>();

  constructor(messages: AgentMessage[] = []) {
    this.nodes.set("n1", {
      id: "n1",
      sessionId: "sess",
      projectId: "ws",
      title: "Node",
      messages: messages.map((content, seq) => ({ id: `m${seq}`, seq, role: String((content as any).role), content })),
    });
    this.nodes.set("n2", {
      id: "n2",
      sessionId: "sess2",
      projectId: "ws",
      title: "Second",
      messages: [],
    });
  }

  getSettings() { return this.settings; }
  patchSettings() { return this.settings; }
  getApiKeyEnc() { return undefined; }
  setApiKeyEnc() {}
  listProjects() { return this.projects; }
  createProject() { return this.projects[0]; }
  renameProject() {}
  deleteProject() {}
  listWorkspaces() { return this.listProjects(); }
  createWorkspace() { return this.createProject(); }
  renameWorkspace() {}
  deleteWorkspace() {}
  setPinned() {}
  listSessions(projectId: string) { return this.sessions.filter((session) => session.projectId === projectId); }
  getSession(id: string) { return this.sessions.find((session) => session.id === id); }
  ensureDefaultSession(projectId: string) { return this.listSessions(projectId)[0]; }
  createSession(projectId = "ws", title = "新会话", options: { titleState?: "default" | "manual"; branchSource?: BranchSource } = {}) {
    const session: SessionRecord = {
      id: `sess${this.sessions.length + 1}`,
      projectId,
      title,
      createdAt: 1,
      updatedAt: 1,
      order: this.sessions.length,
      titleState: options.titleState,
      branchSource: options.branchSource,
    };
    this.sessions.push(session);
    return session;
  }
  renameSession(id: string, title: string, options: { titleState?: "default" | "manual" } = {}) {
    const session = this.getSession(id);
    if (!session) return;
    session.title = title;
    if (options.titleState) session.titleState = options.titleState;
  }
  deleteSession(id: string) {
    this.sessions = this.sessions.filter((session) => session.id !== id);
    for (const [nodeId, node] of this.nodes) {
      if (node.sessionId === id) this.nodes.delete(nodeId);
    }
  }
  listNodes(sessionId: string) { return [...this.nodes.values()].filter((n) => n.sessionId === sessionId); }
  getNode(id: string) { return this.nodes.get(id); }
  createNode(input: { sessionId?: string; projectId?: string; parentId?: string; title: string; seed?: unknown; frozenContext?: FrozenNodeContext; branchPoint?: NodeBranchPoint }): NodeRecord {
    const session = (input.sessionId ? this.getSession(input.sessionId) : this.ensureDefaultSession(input.projectId ?? "ws")) ?? this.sessions[0];
    const node: NodeRecord = {
      id: `n${this.nodes.size + 1}`,
      sessionId: session.id,
      projectId: session.projectId,
      parentId: input.parentId,
      title: input.title,
      seed: input.seed,
      frozenContext: input.frozenContext,
      branchPoint: input.branchPoint,
      messages: [],
    };
    this.nodes.set(node.id, node);
    return node;
  }
  updateNode(id: string, patch: Partial<{ title: string; titleState: "default" | "manual"; systemPrompt: string; model: any; thinkingLevel: any }>) {
    const node = this.nodes.get(id);
    if (node && Object.prototype.hasOwnProperty.call(patch, "title")) node.title = patch.title!;
    if (node && Object.prototype.hasOwnProperty.call(patch, "titleState")) node.titleState = patch.titleState;
    if (node && Object.prototype.hasOwnProperty.call(patch, "systemPrompt")) node.systemPrompt = patch.systemPrompt;
    if (node && Object.prototype.hasOwnProperty.call(patch, "model")) node.model = patch.model;
    if (node && Object.prototype.hasOwnProperty.call(patch, "thinkingLevel")) node.thinkingLevel = patch.thinkingLevel;
  }
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
  replaceMessageContent(nodeId: string, seq: number, content: AgentMessage) {
    const node = this.nodes.get(nodeId);
    const msg = node?.messages[seq];
    if (msg) {
      msg.role = String((content as any).role);
      msg.content = content;
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

function createEngine(handle: EngineHandle): EngineFactory {
  return {
    build: async () => ({ agent: undefined, handle, configStamp: "test" }),
    configStamp: () => "test",
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

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const assistant = (text: string): AgentMessage => ({ role: "assistant", content: text, timestamp: 0 }) as unknown as AgentMessage;
const contextModel = async () => ({
  providerId: "local",
  modelId: "test-model",
  contextWindowTokens: 4_000,
  maxOutputTokens: 500,
  available: true,
});
const toolResult = (toolCallId: string, toolName: string, text: string): AgentMessage =>
  ({
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  }) as unknown as AgentMessage;

describe("createAgentSession turn runner integration", () => {
  it("creates an independent chat branch from a message boundary", () => {
    const store = new MemoryStore([user("first"), assistant("answer"), user("later")]);
    const source = store.getNode("n1")!;
    source.model = { providerId: "local", modelId: "source-model" };
    source.thinkingLevel = "high";
    source.systemPrompt = "source persona";
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: (() => { let n = 0; return () => `branch-message-${n++}`; })() },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const result = session.branchFromMessage({ nodeId: "n1", sourceSeq: 1, mode: "new-session" });

    expect(result).toMatchObject({ ok: true, mode: "new-session" });
    const branchSession = store.getSession(result.sessionId!);
    const branchNode = store.getNode(result.nodeId!);
    expect(branchSession?.branchSource).toEqual({ projectId: "ws", sessionId: "sess", nodeId: "n1", messageSeq: 1 });
    expect(branchNode?.messages.map((message) => String((message.content as any).content))).toEqual(["first", "answer"]);
    expect(branchNode).toMatchObject({ model: source.model, thinkingLevel: source.thinkingLevel, systemPrompt: source.systemPrompt });

    store.appendMessages("n1", [{ id: "late", seq: 3, role: "user", content: user("after branch") }]);
    expect(branchNode?.messages.map((message) => String((message.content as any).content))).not.toContain("after branch");
  });

  it("creates a canvas branch with a frozen context ending at the selected message", () => {
    const store = new MemoryStore([user("first"), assistant("answer"), user("later")]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: (() => { let n = 0; return () => `canvas-branch-${n++}`; })() },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const result = session.branchFromMessage({ nodeId: "n1", sourceSeq: 1, mode: "canvas-node" });
    const branchNode = store.getNode(result.nodeId!);

    expect(result).toMatchObject({ ok: true, mode: "canvas-node", sessionId: "sess" });
    expect(branchNode).toMatchObject({
      parentId: "n1",
      branchPoint: { sourceNodeId: "n1", sourceMessageSeq: 1 },
      frozenContext: { version: 1 },
    });
    expect(branchNode?.frozenContext?.messages.map((message) => String((message as any).content))).toEqual(["first", "answer"]);
  });

  it("rolls back an independent branch when transcript copying fails", () => {
    const store = new MemoryStore([user("first"), assistant("answer")]);
    const existingSessionIds = store.sessions.map((session) => session.id);
    vi.spyOn(store, "appendMessages").mockImplementation((nodeId) => {
      if (nodeId !== "n1") throw new Error("copy failed");
    });
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "rollback-message" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    expect(session.branchFromMessage({ nodeId: "n1", sourceSeq: 1, mode: "new-session" })).toEqual({
      ok: false,
      reason: "copy failed",
    });
    expect(store.sessions.map((stored) => stored.id)).toEqual(existingSessionIds);
    expect([...store.nodes.keys()]).toEqual(["n1", "n2"]);
  });

  it("microCompacts stale model-facing tool results without mutating stored transcript", () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "loom-microcompact-user-data-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "loom-microcompact-source-root-"));
    const oldOutput = "old tool output that should stay out of diagnostics";
    const recentOutput = "recent tool output";
    const store = new MemoryStore([
      assistant("done"),
      toolResult("tc-old", "project_grep", oldOutput),
      toolResult("tc-recent", "project_grep", recentOutput),
    ]);
    store.projects[0].sourceRoots = [sourceRoot];
    const eventLog = events();
    let init: NodeInit | undefined;

    try {
      createAgentSession({
        store,
        events: eventLog.sink,
        ids: { message: () => "id" },
        clock: { now: () => 90 * 60_000 },
        getApiKey: () => "key",
        userDataDir,
        toolResultMicroCompact: { idleGapMinutes: 60, keepRecentToolResults: 1 },
        createEngine: (hooks) => {
          init = hooks.getNodeInit("n1");
          return createEngine(createHandle([], vi.fn()));
        },
      });

      const projectedOld = init?.messages[1] as any;
      const projectedRecent = init?.messages[2] as any;
      expect(projectedOld.content[0].text).toContain("stale_tool_result_microcompact");
      expect(projectedOld.content[0].text).toContain("toolCallId: tc-old");
      expect(projectedOld.content[0].text).toContain(join(userDataDir, "sessions", "sess", "tool-results", "tc-old.txt"));
      expect(projectedOld.content[0].text).not.toContain(oldOutput);
      expect(projectedRecent.content[0].text).toBe(recentOutput);

      const stored = store.getNode("n1")?.messages[1]?.content as any;
      expect(stored.content[0].text).toBe(oldOutput);
      expect(readFileSync(join(userDataDir, "sessions", "sess", "tool-results", "tc-old.txt"), "utf-8")).toBe(oldOutput);
      expect(existsSync(join(sourceRoot, "sess", "tool-results", "tc-old.txt"))).toBe(false);

      const event = eventLog.items.find((item) => item.type === "microcompact");
      expect(event).toMatchObject({
        nodeId: "n1",
        type: "microcompact",
        payload: expect.objectContaining({
          trigger: "time_idle",
          idleGapMinutes: 90,
          retainedCount: 1,
          replacedCount: 1,
        }),
      });
      expect(JSON.stringify(event?.payload)).not.toContain(oldOutput);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("does not emit microCompact diagnostics when projection is a no-op", () => {
    const store = new MemoryStore([
      assistant("done"),
      toolResult("tc-old", "project_grep", "old"),
      toolResult("tc-recent", "project_grep", "recent"),
    ]);
    const eventLog = events();

    createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 10 * 60_000 },
      getApiKey: () => "key",
      toolResultMicroCompact: { idleGapMinutes: 60, keepRecentToolResults: 1 },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    expect(eventLog.items.some((item) => item.type === "microcompact")).toBe(false);
  });

  it("keeps raw budget estimates free of microCompact side effects", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "loom-budget-microcompact-user-data-"));
    const store = new MemoryStore([
      assistant("done"),
      toolResult("tc-old", "project_grep", "old output"),
      toolResult("tc-recent", "project_grep", "recent output"),
    ]);
    const eventLog = events();
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 90 * 60_000 },
      getApiKey: () => "key",
      userDataDir,
      toolResultMicroCompact: { idleGapMinutes: 60, keepRecentToolResults: 1 },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    try {
      expect((await session.budget("n1")).estimated).toBe(true);
      expect(eventLog.items.some((item) => item.type === "microcompact")).toBe(false);
      expect(existsSync(join(userDataDir, "sessions", "sess", "tool-results", "tc-old.txt"))).toBe(false);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it("resets microCompact state after edit-resend truncation", async () => {
    const store = new MemoryStore([
      assistant("done"),
      toolResult("tc-old", "project_grep", "old output"),
      toolResult("tc-recent", "project_grep", "recent output"),
      user("retry from here"),
    ]);
    const eventLog = events();
    let init: NodeInit | undefined;
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 90 * 60_000 },
      getApiKey: () => "key",
      toolResultMicroCompact: { idleGapMinutes: 60, keepRecentToolResults: 1 },
      createEngine: (hooks) => {
        init = hooks.getNodeInit("n1");
        return createEngine(createHandle(messages, vi.fn(async (msg) => {
          messages.push(msg, assistant("updated"));
        })));
      },
    });
    expect((init?.messages[1] as any).content[0].text).toContain("stale_tool_result_microcompact");
    const before = eventLog.items.filter((item) => item.type === "microcompact").length;

    await expect(session.editResend({ nodeId: "n1", seq: 3, text: "retry edited" })).resolves.toMatchObject({ ok: true });

    const after = eventLog.items.filter((item) => item.type === "microcompact").length;
    expect(after).toBe(before + 1);
  });

  it("bounds model-facing tool results without mutating stored transcript", () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "loom-user-data-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "loom-source-root-"));
    const huge = "x".repeat(200_001);
    const store = new MemoryStore([toolResult("tc-big", "big_tool", huge)]);
    store.projects[0].sourceRoots = [sourceRoot];
    const eventLog = events();
    let init: NodeInit | undefined;

    try {
      createAgentSession({
        store,
        events: eventLog.sink,
        ids: { message: () => "id" },
        clock: { now: () => 1 },
        getApiKey: () => "key",
        userDataDir,
        createEngine: (hooks) => {
          init = hooks.getNodeInit("n1");
          return createEngine(createHandle([], vi.fn()));
        },
      });

      const projected = init?.messages[0] as any;
      expect(projected.content[0].text).toContain("tool_result_group_budget_exceeded");
      expect(projected.content[0].text).toContain(join(userDataDir, "sessions", "sess", "tool-results", "tc-big.txt"));
      expect(projected.content[0].text).not.toContain(huge);

      const stored = store.getNode("n1")?.messages[0]?.content as any;
      expect(stored.content[0].text).toBe(huge);
      expect(readFileSync(join(userDataDir, "sessions", "sess", "tool-results", "tc-big.txt"), "utf-8")).toBe(huge);
      expect(existsSync(join(sourceRoot, "sess", "tool-results", "tc-big.txt"))).toBe(false);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("does not resolve local coding tools for an unlinked project", () => {
    const store = new MemoryStore();
    const eventLog = events();
    let getTools: ((nodeId: string) => AgentTool[]) | undefined;
    createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getTools = hooks.getTools;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    expect(getTools?.("n1").some((tool) => tool.name.startsWith("project_"))).toBe(false);
  });

  it("injects the dynamic memory contract only when the memory port provides it", () => {
    const store = new MemoryStore();
    let getNodeInit: ((nodeId: string) => any) | undefined;
    createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      memory: {
        retrieve: async () => ({ issues: [] }),
        memoryPrompt: () => "MEMORY CONTRACT",
        handleCommand: async () => ({ handled: false, ok: false }),
        afterTurn: async () => undefined,
      },
      createEngine: (hooks) => {
        getNodeInit = hooks.getNodeInit;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    expect(getNodeInit?.("n1")?.systemPrompt).toContain("MEMORY CONTRACT");
  });

  it("resolves project coding tools dynamically for the node project", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-tools-"));
    writeFileSync(join(root, "file.ts"), "export {};", "utf-8");
    const store = new MemoryStore();
    store.projects[0].sourceRoots = [root];
    const eventLog = events();
    let getTools: ((nodeId: string) => AgentTool[]) | undefined;
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getTools = hooks.getTools;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    try {
      expect(getTools?.("n1").map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "now", "calc", "web_fetch", "read", "project_list_files", "project_find_files", "project_grep",
        "write", "edit",
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("injects selected project files into the model context without changing the user text", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-file-mention-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const answer = 42;", "utf-8");
    const store = new MemoryStore();
    store.projects[0].sourceRoots = [root];
    const messages: AgentMessage[] = [];
    const prompt = vi.fn(async (message: AgentMessage) => {
      messages.push(message, assistant("ok"));
    });
    const setSystemPrompt = vi.fn();
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine({ ...createHandle(messages, prompt), setSystemPrompt }),
    });

    try {
      await expect(session.send({
        nodeId: "n1",
        text: "summarize this file",
        mentions: [{ root: "project:0", path: "src/index.ts" }],
      })).resolves.toMatchObject({ ok: true });

      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ content: "summarize this file" }));
      expect(setSystemPrompt).toHaveBeenCalledWith(expect.stringContaining("### @src/index.ts"));
      expect(setSystemPrompt).toHaveBeenCalledWith(expect.stringContaining("export const answer = 42;"));
      expect(store.getNode("n1")?.messages.map((message) => String((message.content as any).content))).toContain("summarize this file");
      expect(session.open("sess")[0]?.messages[0]).toMatchObject({
        fileMentions: [{ root: "project:0", path: "src/index.ts" }],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes active global skills to the agent as the read tool", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-skill-tools-"));
    try {
      const skillRoot = join(root, "research");
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: research\ndescription: Research helper\n---\n# Research\n", "utf-8");
      const store = new MemoryStore();
      store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
      let getTools: ((nodeId: string) => AgentTool[]) | undefined;
      createAgentSession({
        store,
        events: events().sink,
        ids: { message: () => "id" },
        clock: { now: () => 1 },
        getApiKey: () => "key",
        createEngine: (hooks) => {
          getTools = hooks.getTools;
          return createEngine(createHandle([], vi.fn()));
        },
      });

      expect(getTools?.("n1").map((tool) => tool.name)).toContain("skill_read");
      expect(getTools?.("n1").map((tool) => tool.name)).not.toContain("skill_list");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves local tools from each node's owning Project sourceRoots", async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "loom-session-project-one-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "loom-session-project-two-"));
    writeFileSync(join(firstRoot, "only-first.ts"), "export const first = true;", "utf-8");
    writeFileSync(join(secondRoot, "only-second.ts"), "export const second = true;", "utf-8");
    const store = new MemoryStore();
    store.projects = [
      { id: "project-one", name: "One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [firstRoot] },
      { id: "project-two", name: "Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1, sourceRoots: [secondRoot] },
    ];
    store.sessions = [
      { id: "sess", projectId: "project-one", title: "Session", createdAt: 1, updatedAt: 1, order: 0 },
      { id: "sess2", projectId: "project-two", title: "Second", createdAt: 1, updatedAt: 1, order: 1 },
    ];
    store.nodes.get("n1")!.projectId = "project-one";
    store.nodes.get("n2")!.projectId = "project-two";
    const eventLog = events();
    let getTools: ((nodeId: string) => AgentTool[]) | undefined;
    createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getTools = hooks.getTools;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    try {
      const firstRead = getTools?.("n1").find((tool) => tool.name === "read")!;
      const secondRead = getTools?.("n2").find((tool) => tool.name === "read")!;

      await expect(firstRead.execute({ toolCallId: "t1", args: { root: firstRoot, path: "only-first.ts" } })).resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("first") }],
      });
      await expect(firstRead.execute({ toolCallId: "t2", args: { root: secondRoot, path: "only-second.ts" } })).rejects.toThrow("source roots");
      await expect(secondRead.execute({ toolCallId: "t3", args: { root: secondRoot, path: "only-second.ts" } })).resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("second") }],
      });
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  it("uses the title model to name a default session and root node after the first prompt", async () => {
    const store = new MemoryStore();
    store.sessions[0].title = "新会话";
    store.sessions[0].titleState = "default";
    store.nodes.get("n1")!.title = "起点";
    store.nodes.get("n1")!.titleState = "default";
    store.nodes.get("n1")!.messages = [];
    const titleGenerator = {
      generate: vi.fn(async () => "BTC 策略研究"),
    };
    const messages: AgentMessage[] = [];
    const eventLog = events();
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(messages, vi.fn(async (msg) => {
        messages.push(msg, assistant("ok"));
      }))),
      titleGenerator,
    });

    await expect(session.send({ nodeId: "n1", text: "帮我分析 polymarket btc 5min 策略，先看数据结构" })).resolves.toMatchObject({ ok: true });

    expect(titleGenerator.generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "帮我分析 polymarket btc 5min 策略，先看数据结构",
    }));
    expect(store.getSession("sess")?.title).toBe("BTC 策略研究");
    expect(store.getSession("sess")?.titleState).toBe("manual");
    expect(store.getNode("n1")?.title).toBe("BTC 策略研究");
    expect(store.getNode("n1")?.titleState).toBe("manual");
    expect(eventLog.items).toContainEqual({
      nodeId: "n1",
      type: "node_updated",
      payload: { id: "n1", sessionId: "sess", title: "BTC 策略研究" },
    });
  });

  it("does not overwrite manually named sessions with the title model", async () => {
    const store = new MemoryStore();
    store.sessions[0].title = "用户标题";
    store.sessions[0].titleState = "manual";
    store.nodes.get("n1")!.title = "起点";
    store.nodes.get("n1")!.titleState = "default";
    store.nodes.get("n1")!.messages = [];
    const titleGenerator = {
      generate: vi.fn(async () => "模型标题"),
    };
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(messages, vi.fn(async (msg) => {
        messages.push(msg, assistant("ok"));
      }))),
      titleGenerator,
    });

    await expect(session.send({ nodeId: "n1", text: "第一条问题" })).resolves.toMatchObject({ ok: true });

    expect(store.getSession("sess")?.title).toBe("用户标题");
    expect(store.getNode("n1")?.title).toBe("模型标题");
  });

  it("inherits skill context through branches independently of mounted ancestor dialogue", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-skills-"));
    const skillRoot = join(root, "research");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: research\ndescription: Research helper\n---\n# Research\n", "utf-8");
    const store = new MemoryStore([{ role: "user", content: "ancestor dialogue" } as unknown as AgentMessage]);
    store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
    const eventLog = events();
    let buildContext: ((nodeId: string, own: AgentMessage[]) => any) | undefined;
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        buildContext = hooks.buildContext;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    try {
      expect(session.enableSkill({ nodeId: "n1", skillId: "research" })).toMatchObject({ ok: true });
      const child = session.create({ sessionId: "sess", parentId: "n1", title: "child" });
      expect(child.hasFrozenContext).toBe(false);

      const inherited = await buildContext!(child.id, []);
      expect(inherited).toEqual([]);

      expect(session.disableSkill({ nodeId: child.id, skillId: "research" })).toMatchObject({ ok: true });
      expect(await buildContext!(child.id, store.listMessages(child.id).map((m) => m.content))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("freezes mounted parent context when a branch is created", async () => {
    const store = new MemoryStore([
      { role: "user", content: "parent question" } as unknown as AgentMessage,
      { role: "assistant", content: "parent answer" } as unknown as AgentMessage,
    ]);
    let buildContext: ((nodeId: string, own: AgentMessage[]) => any) | undefined;
    const session = createAgentSession({
      store, events: events().sink, ids: { message: () => "id" }, clock: { now: () => 1 }, getApiKey: () => "key",
      createEngine: (hooks) => { buildContext = hooks.buildContext; return createEngine(createHandle([], vi.fn())); },
    });

    const child = session.create({ sessionId: "sess", parentId: "n1", seed: { text: "selected", from: "Node", parent: "n1" }, includeParentContext: true });
    store.appendMessages("n1", [{ id: "late", seq: 2, role: "user", content: { role: "user", content: "later parent message" } as AgentMessage }]);

    expect((await buildContext!(child.id, [])).map((message: any) => String(message.content))).toEqual([
      "parent question",
      "parent answer",
      expect.stringContaining("selected"),
    ]);
  });

  it("initializes a mounted branch agent with the parent history followed by its seed", () => {
    const store = new MemoryStore([
      user("message a"),
      assistant("message b"),
      user("message c"),
    ]);
    let getNodeInit: ((nodeId: string) => NodeInit | undefined) | undefined;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getNodeInit = hooks.getNodeInit;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    const child = session.create({
      sessionId: "sess",
      parentId: "n1",
      seed: { text: "selected seed", from: "Node", parent: "n1" },
      includeParentContext: true,
    });

    const init = getNodeInit!(child.id)!;
    expect(init.messages.map((message: any) => String(message.content))).toEqual([
      "message a",
      "message b",
      "message c",
      expect.stringContaining("selected seed"),
    ]);
  });

  it("initializes an unmounted branch agent with only its seed", () => {
    const store = new MemoryStore([user("parent history")]);
    let getNodeInit: ((nodeId: string) => NodeInit | undefined) | undefined;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getNodeInit = hooks.getNodeInit;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    const child = session.create({
      sessionId: "sess",
      parentId: "n1",
      seed: { text: "only seed", from: "Node", parent: "n1" },
    });

    const init = getNodeInit!(child.id)!;
    expect(init.messages).toHaveLength(1);
    expect(String((init.messages[0] as any).content)).toContain("only seed");
    expect(JSON.stringify(init.messages)).not.toContain("parent history");
  });

  it("inherits a mounted parent's custom system prompt", () => {
    const store = new MemoryStore();
    store.nodes.get("n1")!.systemPrompt = "parent persona";
    let getNodeInit: ((nodeId: string) => NodeInit | undefined) | undefined;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getNodeInit = hooks.getNodeInit;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    const child = session.create({ sessionId: "sess", parentId: "n1", includeParentContext: true });

    expect(getNodeInit!(child.id)?.systemPrompt).toContain("parent persona");
    expect(getNodeInit!(child.id)?.systemPrompt).toContain("File tool path contract");
  });

  it("does not let later parent checkpoints change an existing mounted child", async () => {
    const store = new MemoryStore([user("parent question"), assistant("parent answer")]);
    let buildContext: ((nodeId: string, own: AgentMessage[]) => any) | undefined;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        buildContext = hooks.buildContext;
        return createEngine(createHandle([], vi.fn()));
      },
    });
    const child = session.create({ sessionId: "sess", parentId: "n1", seed: { text: "selected", from: "Node", parent: "n1" }, includeParentContext: true });
    store.appendMessages("n1", [
      {
        id: "parent-cp",
        seq: 2,
        role: "loomContextCheckpoint",
        content: createLoomContextCheckpoint({
          id: "parent-cp",
          nodeId: "n1",
          createdAt: 2,
          reason: "threshold",
          summary: "PARENT CHECKPOINT AFTER CHILD",
          coverage: { fromSeq: 0, toSeq: 1 },
          retainedTail: { fromSeq: 2, toSeq: 2 },
          diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 20, exact: true } },
        }) as unknown as AgentMessage,
      },
    ]);

    expect(JSON.stringify(await buildContext!(child.id, []))).not.toContain("PARENT CHECKPOINT AFTER CHILD");
  });

  it("persists a child-owned frozen effective projection when mounted parent context is large", async () => {
    const long = "x".repeat(20_000);
    const store = new MemoryStore([user(`parent question ${long}`), assistant(`parent answer ${long}`), user(`followup ${long}`), assistant(`final ${long}`)]);
    let buildContext: ((nodeId: string, own: AgentMessage[]) => any) | undefined;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 77 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        buildContext = hooks.buildContext;
        return createEngine(createHandle([], vi.fn()));
      },
    });

    const child = session.create({ sessionId: "sess", parentId: "n1", seed: { text: "selected", from: "Node", parent: "n1" }, includeParentContext: true });
    store.appendMessages("n1", [{ id: "late", seq: 4, role: "user", content: user("AFTER_CHILD_PARENT_MUTATION") }]);

    const storedChild = store.getNode(child.id)! as any;
    const projected = await buildContext!(child.id, []);

    expect(storedChild.frozenContext).toMatchObject({ version: 1 });
    const projectedText = projected.map((message: any) => String(message.content));
    expect(projectedText[0]).toEqual(expect.stringContaining("parent question"));
    expect(projectedText[projectedText.length - 1]).toEqual(expect.stringContaining("selected"));
    expect(JSON.stringify(projected)).not.toContain("AFTER_CHILD_PARENT_MUTATION");
  });

  it("does not hydrate Loom skill events into the provider transcript after enabling a skill", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-skill-init-"));
    const skillRoot = join(root, "research");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: research\ndescription: Research helper\n---\n# Research\n", "utf-8");
    const store = new MemoryStore([{ role: "assistant", content: "before" } as unknown as AgentMessage]);
    store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
    let getNodeInit: ((nodeId: string) => NodeInit | undefined) | undefined;
    let buildContext: ((nodeId: string, own: AgentMessage[]) => any) | undefined;
    createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
        getNodeInit = hooks.getNodeInit;
        buildContext = hooks.buildContext;
        return createEngine(createHandle([], vi.fn()));
      },
    }).enableSkill({ nodeId: "n1", skillId: "research" });

    try {
      const initMessages = getNodeInit!("n1")!.messages;
      expect(initMessages.map((message) => (message as any).role)).toEqual(["assistant"]);
      expect(buildContext!("n1", [...initMessages, { role: "user", content: "next" } as unknown as AgentMessage]).map((message: any) => message.role)).toEqual(["assistant", "user"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps skill events out of primary chat messages while exposing effective skill metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-skill-dto-"));
    const skillRoot = join(root, "research");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: research\ndescription: Research helper\n---\n# Research\n", "utf-8");
    const store = new MemoryStore();
    store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    try {
      const result = session.enableSkill({ nodeId: "n1", skillId: "research" });
      expect(result).toMatchObject({ ok: true });
      const node = result.node;
      if (!node) throw new Error("enableSkill did not return a node");
      expect(node.messages).toEqual([]);
      expect(node.skills).toMatchObject([{ id: "research" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores derived checkpoint records as preload-safe timeline messages", () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: "n1",
      createdAt: 10,
      reason: "threshold",
      summary: "Goal\n- continue the task",
      coverage: { fromSeq: 0, toSeq: 1 },
      retainedTail: { fromSeq: 2, toSeq: 2 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 40, exact: false } },
      summaryUsage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, exact: true },
    }) as unknown as AgentMessage;
    const store = new MemoryStore([user("before"), assistant("covered"), checkpoint, user("tail")]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const [node] = session.open("sess");

    expect(node.messages.map((message: any) => message.role)).toEqual(["user", "assistant", "checkpoint", "user"]);
    expect(node.messages[2]).toMatchObject({
      role: "checkpoint",
      text: "Goal\n- continue the task",
      checkpoint: {
        id: "cp-1",
        kind: "context",
        reason: "threshold",
        coverage: { fromSeq: 0, toSeq: 1 },
        diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 40, exact: false } },
      },
    });
  });

  it("invalidates retained checkpoints that cover an edit-resend truncation without rewriting source messages", async () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: "n1",
      createdAt: 10,
      reason: "threshold",
      summary: "covered",
      coverage: { fromSeq: 0, toSeq: 3 },
      retainedTail: { fromSeq: 4, toSeq: 4 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 40, exact: true } },
      attachments: [{ version: 1, kind: "file-context", id: "file:src/app.ts", source: { identity: "file:src/app.ts", path: "src/app.ts" }, text: "old", tokens: { tokens: 1, exact: false } }],
    }) as unknown as AgentMessage;
    const store = new MemoryStore([user("first"), checkpoint, user("edit me"), assistant("old answer")]);
    const engineMessages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 99 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        engineMessages.push(message);
      }))),
    });

    await session.editResend({ nodeId: "n1", seq: 2, text: "edited" });

    const messages = store.getNode("n1")!.messages;
    expect(messages[0]?.content).toMatchObject({ role: "user", content: "first" });
    expect(messages[1]?.content).toMatchObject({ role: "loomContextCheckpoint", invalidatedAt: 99, attachments: [{ id: "file:src/app.ts" }] });
  });

  it("invalidates retained checkpoints that cover a regenerate truncation", async () => {
    const checkpoint = createLoomContextCheckpoint({
      id: "cp-1",
      nodeId: "n1",
      createdAt: 10,
      reason: "threshold",
      summary: "covered",
      coverage: { fromSeq: 0, toSeq: 3 },
      retainedTail: { fromSeq: 4, toSeq: 4 },
      diagnostics: { before: { tokens: 100, exact: true }, after: { tokens: 40, exact: true } },
    }) as unknown as AgentMessage;
    const store = new MemoryStore([user("first"), checkpoint, user("again"), assistant("old answer")]);
    const engineMessages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 123 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async () => {
        engineMessages.push(assistant("new answer"));
      }))),
    });

    await session.regenerate("n1");

    expect(store.getNode("n1")!.messages[1]?.content).toMatchObject({ role: "loomContextCheckpoint", invalidatedAt: 123 });
  });

  it("applies composer-selected skills to only the current prompt without persisting skill events", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-prompt-skill-"));
    const skillRoot = join(root, "research");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: research\ndescription: Research helper\n---\n# Research\n", "utf-8");
    const store = new MemoryStore();
    store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
    const observedContexts: string[][] = [];
    const engineMessages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) =>
        createEngine(createHandle(engineMessages, async (msg) => {
          engineMessages.push(msg);
          const context = await hooks.buildContext("n1", engineMessages);
          observedContexts.push(context.map((item: any) => `${item.role}:${String(item.content).slice(0, 32)}`));
          engineMessages.push({ role: "assistant", content: "done" } as unknown as AgentMessage);
        })),
    });

    try {
      await expect(session.send({ nodeId: "n1", text: "use it", skillIds: ["research"] })).resolves.toEqual({ ok: true });
      expect(observedContexts[0]).toEqual(["user:use it"]);
      expect(store.listMessages("n1").map((m) => (m.content as any).role)).toEqual(["user", "assistant"]);
      expect(session.list("sess")[0]!.skills).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs threshold compaction after a completed turn and appends the checkpoint to the node cache", async () => {
    const store = new MemoryStore([user("old question"), assistant("old answer")]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-threshold" },
      clock: { now: () => 200 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\nthreshold summary" })),
      },
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        engineMessages.push(message, assistant("new answer " + "x".repeat(30_000)));
      }))),
    });

    await expect(session.send({ nodeId: "n1", text: "new question" })).resolves.toEqual({ ok: true });

    const roles = store.listMessages("n1").map((message) => (message.content as any).role);
    expect(roles).toContain("loomContextCheckpoint");
    expect(session.list("sess")[0]!.messages.at(-1)).toMatchObject({ role: "checkpoint", text: "## Goal\nthreshold summary" });
  });

  it("drives automatic compaction from the resolved model window instead of the legacy threshold", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(8_000)), assistant("old answer " + "x".repeat(8_000))]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const summarize = vi.fn(async (_input: unknown, options: { model?: unknown }) => {
      expect(options.model).toMatchObject({ providerId: "local", modelId: "tiny" });
      return { summary: "## Goal\nmodel-aware summary" };
    });
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-model-aware" },
      clock: { now: () => 201 },
      getApiKey: () => "key",
      resolveContextModel: vi.fn(async () => ({
        providerId: "local",
        modelId: "tiny",
        contextWindowTokens: 5_000,
        maxOutputTokens: 500,
        available: true,
      })),
      compaction: {
        summarize,
      },
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        engineMessages.push(message, assistant("new answer"));
      }))),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: true });

    expect(summarize).toHaveBeenCalled();
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).toContain("loomContextCheckpoint");
    const checkpoint = store.listMessages("n1").find((message) => (message.content as any).role === "loomContextCheckpoint")?.content as any;
    expect(checkpoint.diagnostics).toMatchObject({
      model: { providerId: "local", modelId: "tiny" },
      contextWindowTokens: 5_000,
      reserveOutputTokens: 500,
      accountingSource: "estimated",
    });
    await expect(session.budget("n1")).resolves.toMatchObject({
      model: { providerId: "local", modelId: "tiny" },
      contextWindowTokens: 5_000,
      safeInputBudget: 4_500,
    });
  });

  it("reports unavailable model context metadata without appending a checkpoint", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(8_000)), assistant("old answer " + "x".repeat(8_000))]);
    const eventLog = events();
    const summarize = vi.fn(async () => ({ summary: "should not run" }));
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "cp-unavailable" },
      clock: { now: () => 202 },
      getApiKey: () => "key",
      resolveContextModel: async () => ({ providerId: "local", modelId: "unknown", contextWindowTokens: 0, maxOutputTokens: 0, available: false, diagnostic: "missing contextWindow" }),
      compaction: { summarize },
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        engineMessages.push(message, assistant("new answer"));
      }))),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: true });

    expect(summarize).not.toHaveBeenCalled();
    expect(eventLog.items).toContainEqual(expect.objectContaining({
      type: "compaction",
      payload: expect.objectContaining({ state: "failed", reason: "model-unavailable" }),
    }));
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).not.toContain("loomContextCheckpoint");
  });

  it("does not append a checkpoint when automatic threshold summarization fails", async () => {
    const store = new MemoryStore([user("old question"), assistant("old answer")]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-threshold" },
      clock: { now: () => 202 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => {
          throw new Error("summary failed");
        }),
      },
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        engineMessages.push(message, assistant("new answer " + "x".repeat(30_000)));
      }))),
    });

    await expect(session.send({ nodeId: "n1", text: "new question" })).resolves.toEqual({ ok: true });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).not.toContain("loomContextCheckpoint");
  });

  it("runs preflight compaction before appending a new prompt when existing context is already over threshold", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const observedPromptOrder: string[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-preflight" },
      clock: { now: () => 201 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\npreflight summary" })),
      },
      createEngine: () => createEngine(createHandle(engineMessages, vi.fn(async (message) => {
        observedPromptOrder.push(String((message as any).content));
        engineMessages.push(message, assistant("new answer"));
      }))),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: true });

    expect(observedPromptOrder).toEqual(["fresh prompt"]);
    expect(store.listMessages("n1").map((message) => (message.content as any).role).slice(0, 4)).toEqual([
      "user",
      "assistant",
      "loomContextCheckpoint",
      "user",
    ]);
  });

  it("supports manual compaction requests for a node", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-manual" },
      clock: { now: () => 250 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\nmanual summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).toContain("loomContextCheckpoint");
    expect(session.list("sess")[0]!.messages.at(-1)).toMatchObject({ role: "checkpoint", text: "## Goal\nmanual summary" });
  });

  it("attaches paired project file context to the persisted manual checkpoint", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "loom-attachment-source-root-"));
    const call = {
      role: "assistant", content: "", toolCalls: [{ id: "read-1", name: "read", args: { path: "src/app.ts" } }], timestamp: 0,
    } as any;
    const result = {
      role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "const answer = 42;\n" + "x".repeat(20_000) }],
      details: { path: "./src/app.ts", version: "v1", returnedLines: 1, totalLines: 1 }, timestamp: 0,
    } as any;
    const store = new MemoryStore([user("read file"), call, result, user("question"), assistant("answer")]);
    store.projects[0].sourceRoots = [sourceRoot];
    try {
      const session = createAgentSession({
        store,
        events: events().sink,
        ids: { message: () => "cp-file-attachment" },
        clock: { now: () => 250 },
        getApiKey: () => "key",
        compaction: { tailBudgetTokens: 2, summarize: vi.fn(async () => ({ summary: "summary" })) },
        createEngine: () => createEngine(createHandle([], vi.fn())),
      });

      const compactResult = await (session as any).compact("n1");
      expect(compactResult).toEqual({ ok: true, node: expect.anything() });
      const checkpoint = store.listMessages("n1").at(-1)?.content as any;
      expect(checkpoint.role).toBe("loomContextCheckpoint");
      expect(checkpoint.attachments).toHaveLength(1);
      expect(checkpoint.attachments[0]).toMatchObject({ kind: "file-context" });
      expect(checkpoint.attachments[0].source).toMatchObject({ path: "src/app.ts", version: "v1", toolCallId: "read-1" });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("reports projected send budget after checkpoint projection instead of raw retained history", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000)), user("fresh tail")]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-budget" },
      clock: { now: () => 250 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 20,
        summarize: vi.fn(async () => ({ summary: "## Goal\nshort summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    expect((await session.budget("n1")).withoutAncestors).toBeGreaterThan(20_000);
    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    expect((await session.budget("n1")).withoutAncestors).toBeLessThan(1_000);
  });

  it("includes system prompt and skill index in the visible send budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-budget-skills-"));
    const skillRoot = join(root, "long-skill");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: long-skill\ndescription: " + "skill context ".repeat(400) + "\n---\n# Long Skill\n", "utf-8");
    const store = new MemoryStore([user("short")]);
    store.settings = { ...DEFAULT_SETTINGS, skills: { globalSources: [root] } };
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "budget-system" },
      clock: { now: () => 260 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    try {
      expect((await session.budget("n1")).withoutAncestors).toBeGreaterThan(1_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes pending composer text and images in a budget preview without persisting them", async () => {
    const store = new MemoryStore([user("short")]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "budget-preview" },
      clock: { now: () => 261 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const before = await session.budget("n1");
    const preview = await (session as any).budget("n1", {
      text: "preview text " + "x".repeat(4_000),
      images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
    });

    expect(preview.projectedInputTokens).toBeGreaterThan(before.projectedInputTokens ?? 0);
    expect(store.listMessages("n1")).toHaveLength(1);
  });

  it("includes pending selection context in a budget preview without persisting it", async () => {
    const store = new MemoryStore([user("short")]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "budget-preview-selection" },
      clock: { now: () => 261 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const before = await session.budget("n1");
    const preview = await (session as any).budget("n1", {
      selectionNotes: [{ id: "note-1", text: "选中的一段需要重点比较", annotation: "关注定义" }],
    });

    expect(preview.preview).toMatchObject({ selectionNotes: 1 });
    expect(preview.projectedInputTokens).toBeGreaterThan(before.projectedInputTokens ?? 0);
    expect(store.listMessages("n1")).toHaveLength(1);
  });

  it("returns bounded file mention diagnostics in a preview without authorizing the send", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-budget-preview-mention-"));
    const store = new MemoryStore([user("short")]);
    store.projects[0]!.sourceRoots = [root];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "budget-preview-mention" },
      clock: { now: () => 262 },
      getApiKey: () => "key",
      resolveContextModel: contextModel,
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    try {
      const preview = await (session as any).budget("n1", {
        text: "inspect this",
        mentions: [{ root: "project:0", path: "missing.ts" }],
      });
      expect(preview.preview).toMatchObject({ files: 0, errors: [{ path: "missing.ts" }] });
      expect(store.listMessages("n1")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends selection context as bounded model context while keeping visible user text separate", async () => {
    const store = new MemoryStore();
    const messages: AgentMessage[] = [];
    const prompt = vi.fn(async (message: AgentMessage) => {
      messages.push(message, assistant("ok"));
    });
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "selection-note" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine({ ...createHandle(messages, prompt), setSystemPrompt: vi.fn() }),
    });

    await expect((session.send as any)({
      nodeId: "n1",
      text: "请比较这两点",
      selectionNotes: [{ id: "note-1", text: "第一段", annotation: "重点看因果关系" }],
    })).resolves.toMatchObject({ ok: true });

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("<loom-selection-context>"),
    }));
    expect(String((prompt.mock.calls[0]?.[0] as any).content)).toContain("请比较这两点");
    expect(session.open("sess")[0]?.messages[0]).toMatchObject({
      text: "请比较这两点",
      selectionNotes: [{ id: "note-1", text: "第一段", annotation: "重点看因果关系" }],
    });
  });

  it("rejects over-limit selection context without starting a turn", async () => {
    const store = new MemoryStore();
    const prompt = vi.fn(async () => undefined);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "selection-note-limit" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], prompt)),
    });

    const result = await (session.send as any)({
      nodeId: "n1",
      text: "不会发送",
      selectionNotes: Array.from({ length: 13 }, (_, index) => ({ id: `note-${index}`, text: `片段-${index}`, annotation: "" })),
    });

    expect(result).toMatchObject({ ok: false, reason: "selection-context-error" });
    expect(prompt).not.toHaveBeenCalled();
    expect(store.listMessages("n1")).toHaveLength(0);
  });

  it("lets manual compaction bypass the automatic threshold gate", async () => {
    const store = new MemoryStore([user("manual old question " + "x".repeat(20_000)), assistant("manual old answer " + "x".repeat(20_000))]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-manual-low" },
      clock: { now: () => 251 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\nmanual low summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).toContain("loomContextCheckpoint");
  });

  it("uses a more aggressive default tail budget for manual compaction", async () => {
    const store = new MemoryStore([
      user("old " + "x".repeat(8_000)),
      assistant("old answer " + "x".repeat(8_000)),
      user("middle " + "x".repeat(8_000)),
      assistant("middle answer " + "x".repeat(8_000)),
      user("recent " + "x".repeat(8_000)),
      assistant("recent answer " + "x".repeat(8_000)),
    ]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-manual-budget" },
      clock: { now: () => 252 },
      getApiKey: () => "key",
      compaction: {
        summarize: vi.fn(async () => ({ summary: "## Goal\nmanual budget summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    const checkpoint = store.listMessages("n1").find((message) => (message.content as any).role === "loomContextCheckpoint")?.content as any;
    expect(checkpoint.retainedTail.fromSeq).toBeGreaterThanOrEqual(5);
    expect(checkpoint.diagnostics.after.tokens).toBeLessThan(7_000);
  });

  it("aborts an in-flight manual compaction without persisting a partial checkpoint", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const gate = deferred<{ summary: string }>();
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-manual" },
      clock: { now: () => 251 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(() => gate.promise),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    const run = (session as any).compact("n1");
    session.abort("n1");
    gate.resolve({ summary: "## Goal\nlate manual summary" });

    await expect(run).resolves.toEqual({ ok: false, reason: "aborted" });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).not.toContain("loomContextCheckpoint");
  });

  it("reports manual compaction summarization failures instead of not_needed", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-manual" },
      clock: { now: () => 252 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => {
          throw new Error("summary model unavailable");
        }),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    await expect((session as any).compact("n1")).resolves.toEqual({
      ok: false,
      reason: "failed",
      error: "summary model unavailable",
    });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).not.toContain("loomContextCheckpoint");
  });

  it("recovers from context overflow once by compacting and retrying the originating send", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const prompt = vi.fn(async () => {
      throw new Error("context overflow");
    });
    const cont = vi.fn(async () => {
      engineMessages.push(assistant("retry answer"));
    });
    const handle = createHandle(engineMessages, prompt);
    handle.continue = cont;
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-overflow" },
      clock: { now: () => 260 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\noverflow summary" })),
      },
      createEngine: () => createEngine(handle),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: true, recovered: "overflow" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(cont).toHaveBeenCalledTimes(1);
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).toContain("loomContextCheckpoint");
  });

  it("does not retry indefinitely when overflow recovery also overflows", async () => {
    const store = new MemoryStore([user("old question " + "x".repeat(30_000)), assistant("old answer " + "x".repeat(30_000))]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const handle = createHandle(engineMessages, vi.fn(async () => {
      throw new Error("context overflow");
    }));
    handle.continue = vi.fn(async () => {
      throw new Error("context overflow");
    });
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-overflow" },
      clock: { now: () => 261 },
      getApiKey: () => "key",
      compaction: {
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\noverflow summary" })),
      },
      createEngine: () => createEngine(handle),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: false, reason: "overflow" });
    expect(handle.continue).toHaveBeenCalledTimes(1);
  });

  it("allows ordinary in-project mutation tools in the automatic edit profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-session-mutation-"));
    const store = new MemoryStore();
    store.projects[0].sourceRoots = [root];
    const eventLog = events();
    const engineMessages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) =>
        createEngine(
          createHandle(engineMessages, async (msg) => {
            engineMessages.push(msg);
            const args = { path: "loomtest.md", content: "hello Neo!" };
            const block = await hooks.dispatcher.toolCall({
              nodeId: "n1",
              turnId: hooks.getCurrentTurnId("n1"),
              toolName: "write",
              toolCallId: "tc-write",
              args,
            });
            if (block) throw new Error(block.reason ?? "blocked");
            const tool = hooks.getTools("n1").find((candidate) => candidate.name === "write")!;
            const result = await tool.execute({ toolCallId: "tc-write", args });
            await hooks.dispatcher.toolResult({
              nodeId: "n1",
              turnId: hooks.getCurrentTurnId("n1"),
              toolName: "write",
              toolCallId: "tc-write",
              args,
              content: result.content as any,
              details: result.details,
              isError: false,
            });
            engineMessages.push({
              role: "toolResult",
              toolName: "write",
              toolCallId: "tc-write",
              content: result.content,
              details: result.details,
              isError: false,
            } as unknown as AgentMessage);
          }),
        ),
    });

    try {
      const run = session.send({ nodeId: "n1", text: "create file" });
      await expect(run).resolves.toEqual({ ok: true });
      expect(eventLog.items.some((item) => item.type === "approval")).toBe(false);
      expect(readFileSync(join(root, "loomtest.md"), "utf-8")).toBe("hello Neo!");
      expect(store.listMessages("n1").map((m) => (m.content as any).role)).toEqual(["user", "toolResult"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it("keeps an active turn running when another session opens", async () => {
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

    await expect(run).resolves.toEqual({ ok: true });
    expect(store.listMessages("n1").map((m) => (m.content as any).content)).toEqual(["go", "late"]);
  });

  it("exposes and clears a Session-scoped live turn while work runs in the background", async () => {
    const store = new MemoryStore();
    const gate = deferred();
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(messages, vi.fn(async (msg) => {
        messages.push(msg);
        await gate.promise;
        messages.push(assistant("done"));
      }))),
    });

    const run = session.send({ nodeId: "n1", text: "go" });
    await vi.waitFor(() => expect(session.liveTurns()).toEqual([
      expect.objectContaining({ nodeId: "n1", sessionId: "sess", state: "running", revision: 1 }),
    ]));

    gate.resolve();
    await expect(run).resolves.toEqual({ ok: true });
    expect(session.liveTurns()).toEqual([]);
  });

  it("defaults unspecified node thinking level to off when building the engine", async () => {
    const store = new MemoryStore();
    let observedInit: NodeInit | undefined;
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => ({
        build: async (nodeId) => {
          observedInit = hooks.getNodeInit(nodeId);
          return {
            agent: undefined,
            handle: createHandle(messages, vi.fn(async (msg) => {
              messages.push(msg, assistant("done"));
            })),
            configStamp: "test",
          };
        },
        configStamp: () => "test",
        listModels: async () => [],
      }),
    });

    await expect(session.send({ nodeId: "n1", text: "go" })).resolves.toEqual({ ok: true });

    expect(observedInit?.thinkingLevel).toBe("off");
  });

  it("invalidates a background turn before its Session is deleted", async () => {
    const store = new MemoryStore();
    const gate = deferred();
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(messages, vi.fn(async (msg) => {
        messages.push(msg);
        await gate.promise;
        messages.push(assistant("late"));
      }))),
    });
    const run = session.send({ nodeId: "n1", text: "go" });
    await vi.waitFor(() => expect(session.liveTurns()).toHaveLength(1));

    session.disposeSession("sess");
    gate.resolve();

    await expect(run).resolves.toEqual({ ok: false, reason: "stale" });
    expect(session.liveTurns()).toEqual([]);
  });

  it("returns session-scoped node DTOs without legacy workspace ownership", () => {
    const store = new MemoryStore();
    const eventLog = events();
    const session = createAgentSession({
      store,
      events: eventLog.sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    expect(session.list("sess")).toEqual([
      expect.objectContaining({
        id: "n1",
        projectId: "ws",
        sessionId: "sess",
      }),
    ]);
    expect(session.list("sess")[0]).not.toHaveProperty("workspaceId");
  });

  it("scopes live turns to their owning Session and isolates cross-Session concurrency", async () => {
    const store = new MemoryStore();
    const gateA = deferred();
    const gateB = deferred();
    const messagesA: AgentMessage[] = [];
    const messagesB: AgentMessage[] = [];

    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine({
        get messages() { return []; },
        prompt: vi.fn(async (msg) => {
          // Route by inspecting which engine was ensured – the test has one engine,
          // but the session caches handles per node. We differentiate by pushing
          // to dedicated arrays per gate resolution order.
        }),
        continue: vi.fn(),
        abort: vi.fn(),
        reset: vi.fn(),
        syncMessages: vi.fn(),
      } as unknown as EngineHandle),
    });

    // Use two independent engines so each Node gets its own gate.
    const engineA = createHandle(messagesA, vi.fn(async (msg) => {
      messagesA.push(msg);
      await gateA.promise;
      messagesA.push(assistant("done-a"));
    }));
    const engineB = createHandle(messagesB, vi.fn(async (msg) => {
      messagesB.push(msg);
      await gateB.promise;
      messagesB.push(assistant("done-b"));
    }));

    const engineMap = new Map<string, EngineHandle>();
    engineMap.set("n1", engineA);
    engineMap.set("n2", engineB);

    const multiSession = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => `id-${Math.random()}` },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => ({
        build: async (nodeId) => ({ agent: undefined, handle: engineMap.get(nodeId) ?? engineA, configStamp: "test" }),
        configStamp: () => "test",
        listModels: async () => [],
      }),
    });

    const runA = multiSession.send({ nodeId: "n1", text: "prompt-a" });
    const runB = multiSession.send({ nodeId: "n2", text: "prompt-b" });

    await vi.waitFor(() => {
      const turns = multiSession.liveTurns();
      expect(turns).toHaveLength(2);
    });

    const turns = multiSession.liveTurns();
    const turnA = turns.find((t) => t.nodeId === "n1");
    const turnB = turns.find((t) => t.nodeId === "n2");
    expect(turnA).toMatchObject({ sessionId: "sess", state: "running" });
    expect(turnB).toMatchObject({ sessionId: "sess2", state: "running" });

    // Complete Session B's turn – only its live turn should clear.
    gateB.resolve();
    await expect(runB).resolves.toEqual({ ok: true });
    await vi.waitFor(() => {
      const remaining = multiSession.liveTurns();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].nodeId).toBe("n1");
    });

    // Complete Session A's turn – now both are gone.
    gateA.resolve();
    await expect(runA).resolves.toEqual({ ok: true });
    expect(multiSession.liveTurns()).toEqual([]);
  });

  it("clears the live turn when a Node is reset", async () => {
    const store = new MemoryStore();
    const gate = deferred();
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: () => createEngine(createHandle(messages, vi.fn(async (msg) => {
        messages.push(msg);
        await gate.promise;
        messages.push(assistant("done"));
      }))),
    });

    const run = session.send({ nodeId: "n1", text: "go" });
    await vi.waitFor(() => expect(session.liveTurns()).toHaveLength(1));

    session.reset("n1");
    gate.resolve();

    await expect(run).resolves.toEqual({ ok: false, reason: "stale" });
    expect(session.liveTurns()).toEqual([]);
  });

  it("records request, tool, and response trace entries during a turn", async () => {
    const store = new MemoryStore();
    let telemetry: { emit: (event: any) => void } | undefined;
    const messages: AgentMessage[] = [];
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "id" },
      clock: { now: () => 1 },
      getApiKey: () => "key",
      createEngine: (hooks) => {
          telemetry = hooks.telemetry;
        return createEngine(createHandle(messages, vi.fn(async () => {
          // 模拟统一 telemetry：llm start → tool start/end → llm end
          const turnId = hooks.getCurrentTurnId?.("n1");
          telemetry?.emit({ type: "llm_start", nodeId: "n1", turnId, requestId: "req", providerId: "p", modelId: "m", at: 1 });
          telemetry?.emit({ type: "tool_start", nodeId: "n1", turnId, toolCallId: "call", toolName: "calc", parentRequestId: "req", at: 1, attributes: { arguments: { expr: "1+1" } } });
          telemetry?.emit({ type: "tool_end", nodeId: "n1", turnId, toolCallId: "call", toolName: "calc", status: "ok", at: 1, attributes: { result: "2" } });
          telemetry?.emit({ type: "llm_end", nodeId: "n1", turnId, requestId: "req", providerId: "p", modelId: "m", status: "ok", at: 1, usage: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 10, exact: true, source: "provider" } });
          messages.push(assistant("done"));
        })));
      },
    });

    await session.send({ nodeId: "n1", text: "go" });

    const snapshot = session.trace("n1");
    const record = snapshot.records[0];
    const kinds = record.spans.map((span) => span.kind);
    expect(kinds).toContain("llm_call");
    expect(kinds).toContain("tool");
    // llm_call span 结束且带 usage
    const llm = record.spans.find((span) => span.kind === "llm_call");
    expect(llm).toMatchObject({ status: "ok", attributes: { usage: { totalTokens: 10 } } });
    // tool span 挂在 llm_call 下
    const tool = record.spans.find((span) => span.kind === "tool");
    expect(tool?.parentSpanId).toBe(llm?.spanId);
  });
});
