// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPayload } from "../../env";
import type { SurfaceCtx } from "../../surfaces";
import { MemorySettings } from "./MemorySettings";

const settings: SettingsPayload = {
  access: { provider: "openai", baseUrl: "", model: "" },
  appearance: { theme: "light", density: "comfortable" },
  monitor: { notify: true },
  memory: { enabled: false, backgroundExtraction: false, autoDream: false },
  sources: { baseUrl: "default", model: "default", key: "none" },
  hasKey: false,
  keyStorage: "local",
  resolvedModel: "gpt-5",
  resolvedTheme: "light",
};

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function installApi(set = vi.fn(async (_patch: unknown) => ({ ok: true }))) {
  const list = vi.fn(async () => ({ records: [{ id: "mem_1", type: "user", scope: { kind: "user" }, status: "active", confidence: 1, description: "A preference", content: "Use Chinese", source: { trigger: "explicit" }, updatedAt: 1 }], issues: [], stats: { active: 1, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 } }));
  const edit = vi.fn(async () => ({ id: "mem_1" }));
  window.api = { settings: { set }, memory: { list, onEvent: vi.fn(() => vi.fn()), autodreamStatus: vi.fn(async () => ({ status: "idle" })), edit } } as unknown as Window["api"];
  return { set, list, edit };
}

function context(overrides: Partial<SurfaceCtx> = {}) {
  return { settings, reloadSettings: vi.fn(), setSettingsSectionState: vi.fn(), ...overrides } as unknown as SurfaceCtx;
}

describe("MemorySettings", () => {
  it("keeps record management available while disabled and saves only the memory patch", async () => {
    const user = userEvent.setup();
    const api = installApi();
    render(<MemorySettings ctx={context()} />);
    expect(await screen.findByText("A preference")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("关闭");

    await user.click(screen.getByRole("checkbox", { name: "启用跨会话长期记忆" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith({ memory: { enabled: true, backgroundExtraction: false, autoDream: false } }));
    expect(api.set.mock.calls[0]?.[0]).not.toHaveProperty("appearance");
  });

  it("keeps project scope while filtering and editing a record", async () => {
    const user = userEvent.setup();
    const api = installApi();
    const project = { id: "project-1", name: "Loom", createdAt: 1, updatedAt: 1, pinned: false, order: 0 };
    render(<MemorySettings ctx={context({ projects: [project], activeProjectId: project.id })} />);
    await waitFor(() => expect(screen.getByText("A preference")).toBeTruthy());
    expect(api.list).toHaveBeenCalledWith({ projectId: "project-1", includeArchived: true });
    await user.click(screen.getByRole("tab", { name: "candidate 0" }));
    expect(screen.queryByText("A preference")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "全部 1" }));

    await user.click(screen.getByRole("button", { name: /A preference/ }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const content = screen.getByRole("textbox", { name: "记忆内容" });
    await user.clear(content);
    await user.type(content, "Updated preference");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith({ id: "mem_1", patch: { description: "A preference", content: "Updated preference" } }));
  });

  it("shows a bounded mutation error instead of closing the edit flow", async () => {
    const user = userEvent.setup();
    const api = installApi();
    api.edit.mockRejectedValueOnce(new Error("edit failed"));
    render(<MemorySettings ctx={context()} />);
    await user.click(await screen.findByRole("button", { name: /A preference/ }));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect((await screen.findAllByText("edit failed")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "编辑记忆" })).toBeTruthy();
  });
});
