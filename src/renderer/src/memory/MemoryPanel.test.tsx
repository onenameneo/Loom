// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryManagementPanel } from "./MemoryPanel";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

describe("Memory management view", () => {
  it("lists lifecycle metadata and refreshes from typed memory IPC", async () => {
    const onEvent = vi.fn(() => vi.fn());
    const remember = vi.fn(async () => ({ id: "mem_new" }));
    const list = vi.fn(async () => ({
      records: [{
        id: "mem_1",
        type: "user",
        scope: { kind: "user" },
        status: "candidate",
        confidence: 0.8,
        description: "Use Chinese",
        content: "Use Chinese by default.",
        source: { trigger: "extracted", sessionId: "s1" },
        updatedAt: 1,
      }],
      issues: [],
      stats: { active: 0, candidates: 1, archived: 0, stale: 0, conflicted: 0, issues: 0 },
    }));
    (window as any).api = {
      memory: {
        list,
        onEvent,
        approve: vi.fn(async () => ({ id: "mem_1" })),
        reject: vi.fn(async () => ({ id: "mem_1" })),
        forget: vi.fn(async () => ({ id: "mem_1" })),
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: false, reason: "sessions" }, newSessions: 0 })),
        autodreamRun: vi.fn(async () => undefined),
        remember,
      },
    };
    render(<MemoryManagementPanel project={{ id: "project-1", name: "Loom", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }} />);
    await waitFor(() => expect(screen.getByText("Use Chinese")).toBeTruthy());
    expect(screen.getAllByText("candidate").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "全部 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "candidate 1" })).toBeTruthy();
    expect(onEvent).toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ projectId: "project-1", includeArchived: true });

    await userEvent.click(screen.getByRole("button", { name: /Use Chinese/ }));
    expect(screen.getByRole("dialog", { name: "记忆详情" })).toBeTruthy();
    expect(screen.getByText("Use Chinese by default.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("dialog", { name: "记忆详情" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "新增记忆" }));
    expect(screen.getByRole("dialog", { name: "新增记忆" })).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: /记忆内容/ }), "默认使用中文回答。");
    await userEvent.click(screen.getByRole("button", { name: "添加记忆" }));
    expect(remember).toHaveBeenCalledWith(expect.objectContaining({ type: "user", content: "默认使用中文回答。" }));
    expect(screen.queryByRole("dialog", { name: "新增记忆" })).toBeNull();
  });

  it("disables AutoDream when the gate is closed and explains why on hover", async () => {
    const onEvent = vi.fn(() => vi.fn());
    (window as any).api = {
      memory: {
        list: vi.fn(async () => ({ records: [], issues: [], stats: { active: 0, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 } })),
        onEvent,
        autodreamStatus: vi.fn(async () => ({ status: "idle", newSessions: 3, gate: { eligible: false, reason: "sessions" } })),
        autodreamRun: vi.fn(async () => undefined),
      },
    };

    render(<MemoryManagementPanel />);
    const autoDreamButton = await screen.findByRole("button", { name: "运行 AutoDream" }) as HTMLButtonElement;
    expect(autoDreamButton.disabled).toBe(true);

    await userEvent.hover(autoDreamButton.parentElement!);
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
    expect(screen.getByRole("tooltip").textContent).toContain("暂不可运行 · 已积累 3 个新会话");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes the open memory detail after confirming forget", async () => {
    const record = {
      id: "mem_1",
      type: "user",
      scope: { kind: "user" },
      status: "active",
      confidence: 0.8,
      description: "Use Chinese",
      content: "Use Chinese by default.",
      source: { trigger: "explicit" },
      updatedAt: 1,
    };
    const list = vi.fn(async () => ({
      records: [record],
      issues: [],
      stats: { active: 1, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 },
    }));
    const forget = vi.fn(async () => record);
    (window as any).api = {
      memory: {
        list,
        onEvent: vi.fn(() => vi.fn()),
        approve: vi.fn(async () => ({ id: "mem_1" })),
        reject: vi.fn(async () => ({ id: "mem_1" })),
        forget,
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: true, reason: "ready" } })),
        autodreamRun: vi.fn(async () => undefined),
      },
    };

    render(<MemoryManagementPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Use Chinese/ }));
    expect(screen.getByRole("dialog", { name: "记忆详情" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "遗忘" }));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(forget).toHaveBeenCalledWith("mem_1", "forgotten from memory settings"));
    expect(screen.queryByRole("dialog", { name: "记忆详情" })).toBeNull();
  });

  it("restores an archived memory to active", async () => {
    const record = {
      id: "mem_archived",
      type: "user",
      scope: { kind: "user" },
      status: "archived",
      confidence: 0.8,
      description: "Archived preference",
      content: "Use a calm tone.",
      source: { trigger: "manual" },
      updatedAt: 1,
    };
    const restore = vi.fn(async () => ({ ...record, status: "active" }));
    const list = vi.fn()
      .mockResolvedValueOnce({ records: [record], issues: [], stats: { active: 0, candidates: 0, archived: 1, stale: 0, conflicted: 0, issues: 0 } })
      .mockResolvedValueOnce({ records: [{ ...record, status: "active" }], issues: [], stats: { active: 1, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 } });
    (window as any).api = {
      memory: {
        list,
        onEvent: vi.fn(() => vi.fn()),
        restore,
        autodreamStatus: vi.fn(async () => ({ status: "idle" })),
      },
    };

    render(<MemoryManagementPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Archived preference/ }));
    await userEvent.click(screen.getByRole("button", { name: "恢复激活" }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith("mem_archived"));
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
  });

  it("permanently deletes an archived memory after confirmation", async () => {
    const record = {
      id: "mem_archived",
      type: "user",
      scope: { kind: "user" },
      status: "archived",
      confidence: 0.8,
      description: "Archived preference",
      content: "Use a calm tone.",
      source: { trigger: "manual" },
      updatedAt: 1,
    };
    const purge = vi.fn(async () => record);
    (window as any).api = {
      memory: {
        list: vi.fn(async () => ({ records: [record], issues: [], stats: { active: 0, candidates: 0, archived: 1, stale: 0, conflicted: 0, issues: 0 } })),
        onEvent: vi.fn(() => vi.fn()),
        purge,
        autodreamStatus: vi.fn(async () => ({ status: "idle" })),
      },
    };

    render(<MemoryManagementPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Archived preference/ }));
    await userEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await userEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(purge).toHaveBeenCalledWith("mem_archived"));
    expect(screen.queryByRole("dialog", { name: "记忆详情" })).toBeNull();
  });
});
