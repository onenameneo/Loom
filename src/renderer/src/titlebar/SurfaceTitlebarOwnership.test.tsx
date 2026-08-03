// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatView from "../canvas/ChatView";
import SessionCanvas from "../canvas/SessionCanvas";
import type { NodeMsg } from "../env";
import type { SurfaceCtx } from "../surfaces";
import { MonitorPanel, SettingsPanel } from "../surfaces";

const titlebarHooks = vi.hoisted(() => ({
  useTitlebar: vi.fn(),
  useTitlebarActions: vi.fn(),
  useTitlebarContext: vi.fn(),
}));

vi.mock("./Titlebar", () => titlebarHooks);
vi.mock("../canvas/Canvas", () => ({ default: () => <div>canvas</div> }));

afterEach(cleanup);

beforeEach(() => {
  titlebarHooks.useTitlebar.mockReset();
  titlebarHooks.useTitlebarActions.mockReset();
  titlebarHooks.useTitlebarContext.mockReset();
});

function surfaceCtx(): SurfaceCtx {
  return {
    projects: [],
    sessions: [],
    activeProjectId: null,
    activeSessionId: null,
    createProject: vi.fn(),
    createSession: vi.fn(),
    goSettings: vi.fn(),
    settings: null,
    reloadSettings: vi.fn(),
    theme: "light",
    setActiveNodeId: vi.fn(),
    sessionMode: "chat",
    setSessionMode: vi.fn(),
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
  it("keeps ChatView's action node stable and calls the latest settings handler", () => {
    const onExpandCanvas = vi.fn();
    const firstGoSettings = vi.fn();
    const messages: NodeMsg[] = [];
    const view = render(
      <ChatView
        {...{
          nodeId: "root",
          initialMessages: messages,
          initialMount: false,
          onBranch: vi.fn(),
          onExpandCanvas,
          noKey: true,
          goSettings: firstGoSettings,
        }}
      />,
    );

    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebar).not.toHaveBeenCalled();
    const actions = titlebarHooks.useTitlebarActions.mock.calls[0][0];

    const latestGoSettings = vi.fn();
    view.rerender(
      <ChatView
        {...{
          nodeId: "root",
          initialMessages: messages,
          initialMount: false,
          onBranch: vi.fn(),
          onExpandCanvas,
          noKey: true,
          goSettings: latestGoSettings,
        }}
      />,
    );
    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(2);
    expect(titlebarHooks.useTitlebarActions.mock.calls[1][0]).toBe(actions);
    render(<>{actions}</>);

    fireEvent.click(screen.getByRole("button", { name: "展开画布" }));
    fireEvent.click(screen.getByRole("button", { name: "未配置 API key · 去设置" }));
    expect(onExpandCanvas).toHaveBeenCalledTimes(1);
    expect(firstGoSettings).not.toHaveBeenCalled();
    expect(latestGoSettings).toHaveBeenCalledTimes(1);
  });

  it("gives MonitorPanel separate context and action registrations", () => {
    render(<MonitorPanel ctx={surfaceCtx()} />);

    expect(titlebarHooks.useTitlebarContext).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebar).not.toHaveBeenCalled();
  });

  it("opens MonitorPanel activity config through the shared modal shell", async () => {
    const ctx = surfaceCtx();
    render(<MonitorPanel ctx={ctx} />);
    render(<>{titlebarHooks.useTitlebarActions.mock.calls[0][0]}</>);

    fireEvent.click(screen.getByRole("button", { name: "活动流配置" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "活动流配置" })).toBeTruthy());
    expect(document.body.querySelector(".settings-dialog-content")).toBeTruthy();
    expect(document.body.querySelector(".dlg-overlay")).toBeTruthy();
    expect(document.body.querySelector(".activity-modal")).toBeNull();
    expect(ctx.refreshActivityStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps MonitorPanel's action registration stable through an unrelated rerender", () => {
    const now = Date.now();
    const ctx = surfaceCtx();
    ctx.activityNow = now;
    ctx.agents = [{ pid: 1, tool: "codex", cwd: "/workspace", startedAt: now, cpu: 0, status: "running" }];
    ctx.activitySessions = [{
      key: "codex:session-1",
      tool: "codex",
      sessionId: "session-1",
      cwd: "/workspace",
      lastActiveAt: now,
      eventCount: 0,
      events: [],
    }];

    const view = render(<MonitorPanel ctx={ctx} />);
    expect(titlebarHooks.useTitlebarContext).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(1);
    const actions = titlebarHooks.useTitlebarActions.mock.calls[0][0];

    view.rerender(<MonitorPanel ctx={{ ...ctx, activityNow: now + 1_000 }} />);
    expect(titlebarHooks.useTitlebarActions).toHaveBeenCalledTimes(2);
    expect(titlebarHooks.useTitlebarActions.mock.calls[1][0]).toBe(actions);
    expect(titlebarHooks.useTitlebar).not.toHaveBeenCalled();
  });

  it("gives SettingsPanel context only", () => {
    render(<SettingsPanel ctx={surfaceCtx()} />);

    expect(titlebarHooks.useTitlebarContext).toHaveBeenCalledTimes(1);
    expect(titlebarHooks.useTitlebarActions).not.toHaveBeenCalled();
    expect(titlebarHooks.useTitlebar).not.toHaveBeenCalled();
  });

  it("does not use the compatibility hook for Workspace", async () => {
    render(
      <SessionCanvas
        sessionId="session-1"
        sessionName="workspace"
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    await waitFor(() => expect(titlebarHooks.useTitlebarContext).toHaveBeenCalled());
    expect(titlebarHooks.useTitlebar).not.toHaveBeenCalled();
  });
});
