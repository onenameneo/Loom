// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryPanel from "./MemoryPanel";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

describe("MemoryPanel", () => {
  it("lists lifecycle metadata and refreshes from typed memory IPC", async () => {
    const onEvent = vi.fn(() => vi.fn());
    const remember = vi.fn(async () => undefined);
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
        approve: vi.fn(async () => undefined),
        reject: vi.fn(async () => undefined),
        forget: vi.fn(async () => undefined),
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: false, reason: "sessions" }, newSessions: 0 })),
        autodreamRun: vi.fn(async () => undefined),
        remember,
      },
    };
    render(<MemoryPanel project={{ id: "project-1", name: "Loom", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }} />);
    await waitFor(() => expect(screen.getByText("Use Chinese")).toBeTruthy());
    expect(screen.getAllByText("candidate").length).toBeGreaterThan(0);
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

    render(<MemoryPanel />);
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
    const forget = vi.fn(async () => undefined);
    (window as any).api = {
      memory: {
        list,
        onEvent: vi.fn(() => vi.fn()),
        approve: vi.fn(async () => undefined),
        reject: vi.fn(async () => undefined),
        forget,
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: true, reason: "ready" } })),
        autodreamRun: vi.fn(async () => undefined),
      },
    };

    render(<MemoryPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Use Chinese/ }));
    expect(screen.getByRole("dialog", { name: "记忆详情" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "遗忘" }));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(forget).toHaveBeenCalledWith("mem_1", "forgotten from memory center"));
    expect(screen.queryByRole("dialog", { name: "记忆详情" })).toBeNull();
  });
});
