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
    projects: [{ id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: ["/Users/neo/code/project-one"] }],
    sessions: [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }],
    activeProjectId: "project-1",
    activeSessionId: "session-1",
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
            title: "Root",
            mountAncestors: false,
            messages: [],
          },
        ]),
      },
    } as unknown as Window["api"];

    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={ctx()}
        onSelectSession={onSelectSession}
        onFocusNode={onFocusNode}
        onCreateProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onPinProject={vi.fn()}
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

  it("supports project create, select, rename, delete, and pin with canonical terminology", async () => {
    const onSelectProject = vi.fn();
    const onCreateProject = vi.fn();
    const onRenameProject = vi.fn();
    const onDeleteProject = vi.fn();
    const onPinProject = vi.fn();
    window.api = {
      platform: "darwin",
      canvas: {
        list: vi.fn(async () => []),
      },
      projects: {
        pickSourceRoot: vi.fn(async () => ({ canceled: false, path: "/Users/neo/code/project-one" })),
      },
    } as unknown as Window["api"];

    const baseCtx = ctx();
    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={{
          ...baseCtx,
          projects: [
            { id: "project-pinned", name: "Pinned Project", createdAt: 1, updatedAt: 1, pinned: true, order: 1, sourceRoots: [] },
            { id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: ["/Users/neo/code/project-one"] },
          ],
        }}
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onCreateProject={onCreateProject}
        onRenameProject={onRenameProject}
        onDeleteProject={onDeleteProject}
        onPinProject={onPinProject}
        onSelectProject={onSelectProject}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("新建项目"));
    fireEvent.click(await screen.findByText("添加 Loom 可读取和编辑的 Source Root"));
    expect(await screen.findByRole("dialog", { name: "创建项目" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreateProject).toHaveBeenCalledWith({
      name: "project-one",
      sourceRoots: ["/Users/neo/code/project-one"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull());

    fireEvent.click(screen.getByText("Project One"));
    expect(onSelectProject).toHaveBeenCalledWith("project-1");

    fireEvent.click(screen.getAllByLabelText("置顶")[0]);
    expect(onPinProject).toHaveBeenCalledWith("project-1", true);

    fireEvent.click(screen.getAllByLabelText("重命名")[1]);
    fireEvent.change(screen.getByDisplayValue("Project One"), { target: { value: "Renamed Project" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameProject).toHaveBeenCalledWith("project-1", "Renamed Project");

    fireEvent.click(screen.getAllByLabelText("删除")[1]);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteProject).toHaveBeenCalledWith("project-1");
  });
});
