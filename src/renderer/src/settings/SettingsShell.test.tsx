// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPayload } from "../env";
import type { SurfaceCtx } from "../surfaces";
import { SettingsShell } from "./SettingsShell";

const settings: SettingsPayload = {
  access: { provider: "anthropic", baseUrl: "", model: "" },
  appearance: { theme: "light", density: "comfortable" },
  monitor: { notify: true },
  permissions: { profile: "auto-edit", sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", networkAccess: false, writableRoots: [], commandOutputLimit: 64000 },
  memory: { enabled: false, backgroundExtraction: false, autoDream: false },
  modelRegistry: { providers: [] },
  sources: { baseUrl: "default", model: "default", key: "none" },
  hasKey: false,
  keyStorage: "local",
  resolvedModel: "claude-sonnet-4-5",
  resolvedTheme: "light",
};

function context(section: "appearance" | "models"): SurfaceCtx {
  return { settings, settingsSection: section, reloadSettings: vi.fn(), setSettingsSectionState: vi.fn() } as unknown as SurfaceCtx;
}

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

describe("SettingsShell", () => {
  it("renders only the selected section and focuses its heading", async () => {
    render(<SettingsShell ctx={context("appearance")} />);
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByText("语言")).toBeTruthy();
    expect(screen.queryByText("模型配置")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "外观" }));
  });

  it("renders the model section without mounting Skills or MCP content", () => {
    render(<SettingsShell ctx={context("models")} />);
    expect(screen.getByRole("heading", { name: "模型配置" })).toBeTruthy();
    expect(screen.queryByText("MCP 配置正在迁移到独立分区。")).toBeNull();
    expect(screen.queryByText("Skills 配置正在迁移到独立分区。")).toBeNull();
  });

  it("registers dirty state for ordinary preference navigation guards", async () => {
    const setSettingsSectionState = vi.fn();
    const user = userEvent.setup();
    render(<SettingsShell ctx={{ ...context("appearance"), setSettingsSectionState } as SurfaceCtx} />);
    await user.click(screen.getByRole("combobox", { name: "主题" }));
    await user.click(screen.getByRole("option", { name: "暗色" }));
    expect(setSettingsSectionState.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ dirty: true }));
  });

  it("does not start unrelated MCP or Skills subscriptions for the model section", () => {
    const mcpList = vi.fn(async () => ({ servers: [], diagnostics: [], revision: 1 }));
    const mcpStatus = vi.fn(() => vi.fn());
    const skills = vi.fn(async () => ({ sources: [], skills: [], activeSkills: [], diagnostics: [] }));
    window.api = { settings: { skills }, mcp: { list: mcpList, onStatus: mcpStatus } } as unknown as Window["api"];
    render(<SettingsShell ctx={context("models")} />);
    expect(mcpList).not.toHaveBeenCalled();
    expect(mcpStatus).not.toHaveBeenCalled();
    expect(skills).not.toHaveBeenCalled();
  });

  it("cleans up the MCP status subscription when leaving the section", () => {
    const cleanupStatus = vi.fn();
    const mcpStatus = vi.fn(() => cleanupStatus);
    window.api = {
      settings: {},
      mcp: { list: vi.fn(async () => ({ servers: [], diagnostics: [], revision: 1 })), onStatus: mcpStatus },
    } as unknown as Window["api"];
    const view = render(<SettingsShell ctx={{ ...context("models"), settingsSection: "mcp" } as SurfaceCtx} />);
    expect(mcpStatus).toHaveBeenCalledOnce();
    view.unmount();
    expect(cleanupStatus).toHaveBeenCalledOnce();
  });
});
