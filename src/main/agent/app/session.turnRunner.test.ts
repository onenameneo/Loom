import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FrozenNodeContext } from "../core/context";
import { createAgentSession } from "./session";
import type { EngineHandle, EventSinkPort, LlmEnginePort, NodeInit } from "../ports";
import type { AgentTool } from "../core/tool";
import { createLoomContextCheckpoint } from "../core/messages";
import type { NodeLayout, NodeRecord, PersistedMessage, SessionRecord, Settings, Store, Project } from "../../store/store";
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
  createSession() { return this.sessions[0]; }
  renameSession(id: string, title: string, options: { titleState?: "default" | "manual" } = {}) {
    const session = this.getSession(id);
    if (!session) return;
    session.title = title;
    if (options.titleState) session.titleState = options.titleState;
  }
  deleteSession() {}
  listNodes(sessionId: string) { return [...this.nodes.values()].filter((n) => n.sessionId === sessionId); }
  getNode(id: string) { return this.nodes.get(id); }
  createNode(input: { sessionId?: string; projectId?: string; parentId?: string; title: string; seed?: unknown; frozenContext?: FrozenNodeContext }): NodeRecord {
    const session = (input.sessionId ? this.getSession(input.sessionId) : this.ensureDefaultSession(input.projectId ?? "ws")) ?? this.sessions[0];
    const node: NodeRecord = {
      id: `n${this.nodes.size + 1}`,
      sessionId: session.id,
      projectId: session.projectId,
      parentId: input.parentId,
      title: input.title,
      seed: input.seed,
      frozenContext: input.frozenContext,
      messages: [],
    };
    this.nodes.set(node.id, node);
    return node;
  }
  updateNode(id: string, patch: Partial<{ title: string; titleState: "default" | "manual" }>) {
    const node = this.nodes.get(id);
    if (node && Object.prototype.hasOwnProperty.call(patch, "title")) node.title = patch.title!;
    if (node && Object.prototype.hasOwnProperty.call(patch, "titleState")) node.titleState = patch.titleState;
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

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;
const assistant = (text: string): AgentMessage => ({ role: "assistant", content: text, timestamp: 0 }) as unknown as AgentMessage;

describe("createAgentSession turn runner integration", () => {
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
        "now", "calc", "web_fetch", "project_read_file", "project_list_files", "project_find_files", "project_grep",
        "project_write_file", "project_edit_file",
      ]));
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
      const firstRead = getTools?.("n1").find((tool) => tool.name === "project_read_file")!;
      const secondRead = getTools?.("n2").find((tool) => tool.name === "project_read_file")!;

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

    expect(getNodeInit!(child.id)?.systemPrompt).toBe("parent persona");
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
    expect(messages[1]?.content).toMatchObject({ role: "loomContextCheckpoint", invalidatedAt: 99 });
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
      compaction: {
        thresholdTokens: 5_000,
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

  it("does not append a checkpoint when automatic threshold summarization fails", async () => {
    const store = new MemoryStore([user("old question"), assistant("old answer")]);
    const engineMessages = store.listMessages("n1").map((message) => message.content);
    const session = createAgentSession({
      store,
      events: events().sink,
      ids: { message: () => "cp-threshold" },
      clock: { now: () => 202 },
      getApiKey: () => "key",
      compaction: {
        thresholdTokens: 5_000,
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
      compaction: {
        thresholdTokens: 10_000,
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
        thresholdTokens: 10_000,
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\nmanual summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    expect(store.listMessages("n1").map((message) => (message.content as any).role)).toContain("loomContextCheckpoint");
    expect(session.list("sess")[0]!.messages.at(-1)).toMatchObject({ role: "checkpoint", text: "## Goal\nmanual summary" });
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
        thresholdTokens: 10_000,
        tailBudgetTokens: 20,
        summarize: vi.fn(async () => ({ summary: "## Goal\nshort summary" })),
      },
      createEngine: () => createEngine(createHandle([], vi.fn())),
    });

    expect(session.budget("n1").withoutAncestors).toBeGreaterThan(20_000);
    await expect((session as any).compact("n1")).resolves.toMatchObject({ ok: true, node: { id: "n1" } });
    expect(session.budget("n1").withoutAncestors).toBeLessThan(1_000);
  });

  it("includes system prompt and skill index in the visible send budget", () => {
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
      expect(session.budget("n1").withoutAncestors).toBeGreaterThan(1_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
        thresholdTokens: 100_000,
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
        thresholdTokens: 100_000,
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
        thresholdTokens: 10_000,
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
        thresholdTokens: 10_000,
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
        thresholdTokens: 10_000,
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
        thresholdTokens: 10_000,
        tailBudgetTokens: 2,
        summarize: vi.fn(async () => ({ summary: "## Goal\noverflow summary" })),
      },
      createEngine: () => createEngine(handle),
    });

    await expect(session.send({ nodeId: "n1", text: "fresh prompt" })).resolves.toEqual({ ok: false, reason: "overflow" });
    expect(handle.continue).toHaveBeenCalledTimes(1);
  });

  it("pauses project mutation tools for approval, then persists the tool result transcript", async () => {
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
              toolName: "project_write_file",
              toolCallId: "tc-write",
              args,
            });
            if (block) throw new Error(block.reason ?? "blocked");
            const tool = hooks.getTools("n1").find((candidate) => candidate.name === "project_write_file")!;
            const result = await tool.execute({ toolCallId: "tc-write", args });
            await hooks.dispatcher.toolResult({
              nodeId: "n1",
              turnId: hooks.getCurrentTurnId("n1"),
              toolName: "project_write_file",
              toolCallId: "tc-write",
              args,
              content: result.content as any,
              details: result.details,
              isError: false,
            });
            engineMessages.push({
              role: "toolResult",
              toolName: "project_write_file",
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
      await vi.waitFor(() => expect(eventLog.items.some((item) => item.type === "approval")).toBe(true));
      expect(existsSync(join(root, "loomtest.md"))).toBe(false);
      const approval = eventLog.items.find((item) => item.type === "approval")!.payload as any;
      expect(JSON.stringify(approval.preview)).not.toContain("hello Neo!");
      expect(session.decideApproval({
        requestId: approval.requestId,
        nodeId: "n1",
        turnId: approval.turnId,
        toolCallId: "tc-write",
        toolName: "project_write_file",
        action: "allow",
        scope: "once",
      })).toEqual({ ok: true });

      await expect(run).resolves.toEqual({ ok: true });
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
});
