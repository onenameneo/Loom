// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import type { SurfaceCtx } from "./surfaces";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function ctx(): SurfaceCtx {
  return {
    workspaces: [{ id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceFolders: ["/Users/neo/code/project-one"] }],
    projects: [{ id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceFolders: ["/Users/neo/code/project-one"] }],
    sessions: [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }],
    activeWorkspaceId: "session-1",
    activeProjectId: "project-1",
    activeSessionId: "session-1",
    createWorkspace: vi.fn(),
    createProject: vi.fn(),
    createSession: vi.fn(),
    goSettings: vi.fn(),
    settings: null,
    reloadSettings: vi.fn(),
    theme: "light",
    focusNodeId: null,
    clearFocusNode: vi.fn(),
    chatNodeId: null,
    setChatNodeId: vi.fn(),
    workspaceMode: "chat",
    setWorkspaceMode: vi.fn(),
    treeVersion: 0,
    bumpTreeVersion: vi.fn(),
    agentCount: 0,
    activitySessions: [],
    agents: [],
    activityStatus: null,
    activeSessionKey: null,
    setActiveSessionKey: vi.fn(),
    activityNow: 1,
    refreshActivityStatus: vi.fn(async () => {}),
    runActivityConfig: vi.fn(async () => {}),
  };
}

describe("Sidebar project session navigation", () => {
  it("renders projects separately from sessions and expands only the selected session outline", async () => {
    const onSelectProject = vi.fn();
    const onSelectSession = vi.fn();
    const onFocusNode = vi.fn();
    window.api = {
      platform: "darwin",
      canvas: {
        list: vi.fn(async () => [
          {
            id: "node-root",
            sessionId: "session-1",
            projectId: "project-1",
            workspaceId: "session-1",
            title: "Root",
            mountAncestors: false,
            messages: [],
          },
        ]),
      },
    } as unknown as Window["api"];

    render(
      <Sidebar
        activeSurface="workspace"
        setSurface={vi.fn()}
        ctx={ctx()}
        onSelectWorkspace={onSelectSession}
        onFocusNode={onFocusNode}
        onCreateWorkspace={vi.fn()}
        onRenameWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onPinWorkspace={vi.fn()}
        onSelectProject={onSelectProject}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    expect(screen.getAllByText("项目").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("会话").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("/Users/neo/code/project-one")).toBeTruthy();
    fireEvent.click(screen.getByText("Project One"));
    fireEvent.click(screen.getByText("Session One"));

    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    expect(onSelectSession).toHaveBeenCalledWith("session-1");
    await waitFor(() => expect(screen.getByText("主线")).toBeTruthy());
    fireEvent.click(screen.getByText("主线"));
    expect(onFocusNode).toHaveBeenCalledWith("session-1", "node-root");
  });
});
