// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatView from "../canvas/ChatView";
import type { SurfaceCtx } from "../surfaces";
import { MonitorPanel, SettingsPanel } from "../surfaces";

const titlebarHooks = vi.hoisted(() => ({
  useTitlebar: vi.fn(),
  useTitlebarActions: vi.fn(),
  useTitlebarContext: vi.fn(),
}));

vi.mock("./Titlebar", () => titlebarHooks);

afterEach(cleanup);

beforeEach(() => {
  titlebarHooks.useTitlebar.mockReset();
  titlebarHooks.useTitlebarActions.mockReset();
  titlebarHooks.useTitlebarContext.mockReset();
});

function surfaceCtx(): SurfaceCtx {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    createWorkspace: vi.fn(),
    goSettings: vi.fn(),
    settings: null,
    reloadSettings: vi.fn(),
    theme: "light",
    treeVersion: 0,
    bumpTreeVersion: vi.fn(),
    agentCount: 0,
    activitySessions: [],
    agents: [],
    activityStatus: null,
    activeSessionKey: null,
    setActiveSessionKey: vi.fn(),
    activityNow: Date.now(),
    refreshActivityStatus: vi.fn(async () => {}),
    runActivityConfig: vi.fn(async () => {}),
  };
}

describe("surface titlebar ownership", () => {
  it("lets ChatView own expand and API-key titlebar actions", () => {
    const onExpandCanvas = vi.fn();
    const goSettings = vi.fn();
    render(
      <ChatView
        {...{
          nodeId: "root",
          initialMessages: [],
          initialMount: false,
          onBranch: vi.fn(),
          onExpandCanvas,
          noKey: true,
          goSettings,
        }}
      />,
    );

    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalled();
    const actions = titlebarHooks.useTitlebarActions.mock.calls.at(-1)![0];
    expect(titlebarHooks.useTitlebarActions.mock.calls.every(([node]) => node === actions)).toBe(true);
    render(<>{actions}</>);

    fireEvent.click(screen.getByRole("button", { name: "展开画布" }));
    fireEvent.click(screen.getByRole("button", { name: "未配置 API key · 去设置" }));
    expect(onExpandCanvas).toHaveBeenCalledTimes(1);
    expect(goSettings).toHaveBeenCalledTimes(1);
  });

  it("gives MonitorPanel separate context and action registrations", () => {
    render(<MonitorPanel ctx={surfaceCtx()} />);

    expect(titlebarHooks.useTitlebarContext).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(1);
  });

  it("gives SettingsPanel context only", () => {
    render(<SettingsPanel ctx={surfaceCtx()} />);

    expect(titlebarHooks.useTitlebarContext).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebarActions).not.toHaveBeenCalled();
  });
});
