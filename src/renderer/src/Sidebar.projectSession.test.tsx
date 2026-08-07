// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import type { SurfaceCtx } from "./surfaces";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspace/store";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetWorkspaceStore();
  delete (window as any).api;
});

function ctx(): SurfaceCtx {
  return {
    projects: [{ id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: ["/Users/neo/code/project-one"] }],
    sessions: [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }],
    activeProjectId: "project-1",
    activeSessionId: "session-1",
    openCreateProject: vi.fn(),
    createSession: vi.fn(),
    goSettings: vi.fn(),
    settings: null,
    reloadSettings: vi.fn(),
    theme: "light",
    activeNodeId: null,
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
    activityNow: 1,
    refreshActivityStatus: vi.fn(async () => {}),
    runActivityConfig: vi.fn(async () => {}),
  };
}

describe("Sidebar project session navigation", () => {
  it("shows a running child Node under its Session without marking its root", async () => {
    useWorkspaceStore.getState().hydrateProjects([{ id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }]);
    useWorkspaceStore.getState().hydrateSessions("project-1", [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }]);
    useWorkspaceStore.getState().hydrateNodes("session-1", [
      { id: "node-root", sessionId: "session-1", projectId: "project-1", title: "起点", messages: [] },
      { id: "node-child", sessionId: "session-1", projectId: "project-1", parentId: "node-root", title: "新分支", messages: [] },
    ]);
    useWorkspaceStore.getState().applyLiveTurn({
      type: "upsert",
      snapshot: { nodeId: "node-child", sessionId: "session-1", turnId: "turn-child", operation: "send", state: "running", revision: 1, assistantText: "" },
    });
    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={ctx()}
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenCreateProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onPinProject={vi.fn()}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Session One" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "起点" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新分支" })).toBeTruthy();
    expect(screen.getByTestId("node-running-node-child")).toBeTruthy();
    expect(screen.queryByTestId("node-running-node-root")).toBeNull();
    expect(screen.queryByLabelText("新分支 会话颜色")).toBeNull();
  });

  it("keeps Node A's running marker when navigation switches to Session B", async () => {
    const projectTwo = { id: "project-2", name: "Project Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1 };
    const sessionTwo = { id: "session-2", projectId: "project-2", title: "Session Two", createdAt: 1, updatedAt: 1, order: 0 };
    useWorkspaceStore.getState().hydrateProjects([ctx().projects[0], projectTwo]);
    useWorkspaceStore.getState().hydrateSessions("project-1", ctx().sessions);
    useWorkspaceStore.getState().hydrateSessions("project-2", [sessionTwo]);
    useWorkspaceStore.getState().hydrateNodes("session-1", [
      { id: "node-a", sessionId: "session-1", projectId: "project-1", title: "Node A", messages: [] },
    ]);
    useWorkspaceStore.getState().hydrateNodes("session-2", [
      { id: "node-b", sessionId: "session-2", projectId: "project-2", title: "Node B", messages: [] },
    ]);
    useWorkspaceStore.getState().applyLiveTurn({
      type: "upsert",
      snapshot: { nodeId: "node-a", sessionId: "session-1", turnId: "turn-a", operation: "send", state: "running", revision: 1, assistantText: "" },
    });
    const view = render(
      <Sidebar
        activeSurface="project" setSurface={vi.fn()}
        ctx={{ ...ctx(), projects: [ctx().projects[0], projectTwo] }}
        onSelectSession={vi.fn()} onFocusNode={vi.fn()} onOpenCreateProject={vi.fn()} onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()} onPinProject={vi.fn()} onCreateSession={vi.fn()} onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()} theme="light" toggleTheme={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("node-running-node-a")).toBeTruthy());

    view.rerender(
      <Sidebar
        activeSurface="project" setSurface={vi.fn()}
        ctx={{ ...ctx(), projects: [ctx().projects[0], projectTwo], activeProjectId: "project-2", activeSessionId: "session-2" }}
        onSelectSession={vi.fn()} onFocusNode={vi.fn()} onOpenCreateProject={vi.fn()} onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()} onPinProject={vi.fn()} onCreateSession={vi.fn()} onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()} theme="light" toggleTheme={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Session Two" })).toBeTruthy());
    expect(screen.getByTestId("node-running-node-a")).toBeTruthy();
    expect(screen.queryByTestId("node-running-node-b")).toBeNull();
  });

  it("renders the Loom brand icon in the sidebar header", () => {
    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={ctx()}
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenCreateProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onPinProject={vi.fn()}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    const brandIcon = screen.getByAltText("Loom") as HTMLImageElement;
    expect(brandIcon.tagName).toBe("IMG");
    expect(brandIcon.getAttribute("src")).toContain("icon.png");
    expect(brandIcon.closest(".sb-mark")).toBeTruthy();
  });

  it("renders an explicit Session above its Node tree", async () => {
    const onSelectProject = vi.fn();
    const onSelectSession = vi.fn();
    const onFocusNode = vi.fn();
    const setActiveNodeId = vi.fn();
    window.api = {
      platform: "darwin",
      canvas: {
        list: vi.fn(async () => [
          {
            id: "node-root",
            sessionId: "session-1",
            projectId: "project-1",
            title: "起点",
            messages: [],
          },
          {
            id: "node-child",
            sessionId: "session-1",
            projectId: "project-1",
            parentId: "node-root",
            title: "新分支",
            messages: [],
          },
        ]),
      },
    } as unknown as Window["api"];
    const baseCtx = { ...ctx(), setActiveNodeId };

    const { rerender } = render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={baseCtx}
        onSelectSession={onSelectSession}
        onFocusNode={onFocusNode}
        onOpenCreateProject={vi.fn()}
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
    expect(screen.getByText("/Users/neo/code/project-one")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("起点")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Session One" })).toBeTruthy();
    expect(document.querySelector(".branch-dot")).toBeNull();
    expect(screen.getByText("起点").closest(".sb-root-row")?.querySelector(".sb-project-chev")).toBeNull();
    expect((screen.getByText("起点").closest(".sb-session-row") as HTMLElement).style.paddingLeft).toBe("16px");
    expect((screen.getByText("起点").closest(".sb-root-row") as HTMLElement).style.paddingLeft).toBe("");
    expect(screen.getByText("Project One").closest(".sb-project")?.classList.contains("active")).toBe(false);
    expect(screen.getByRole("button", { name: "Session One" }).closest(".sb-session-row")?.classList.contains("active")).toBe(true);
    expect(screen.getByText("起点").closest(".sb-branch")?.classList.contains("active")).toBe(false);
    const sessionTitle = screen.getByRole("button", { name: "Session One" });
    const sessionChildren = sessionTitle.closest(".sb-session-row")?.nextElementSibling;
    fireEvent.click(sessionTitle);
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(sessionChildren?.classList.contains("open")).toBe(false);
    fireEvent.click(sessionTitle);
    expect(sessionChildren?.classList.contains("open")).toBe(true);
    fireEvent.click(screen.getByText("起点"));
    expect(onFocusNode).toHaveBeenCalledWith("session-1", "node-root");
    expect(setActiveNodeId).toHaveBeenCalledWith("node-root");

    fireEvent.click(screen.getByText("新分支"));
    expect(onFocusNode).toHaveBeenCalledWith("session-1", "node-child");
    expect(setActiveNodeId).toHaveBeenCalledWith("node-child");
    rerender(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={{ ...baseCtx, activeNodeId: "node-child" }}
        onSelectSession={onSelectSession}
        onFocusNode={onFocusNode}
        onOpenCreateProject={vi.fn()}
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
    expect(screen.getByText("Project One").closest(".sb-project")?.classList.contains("active")).toBe(false);
    expect(screen.getByText("起点").closest(".sb-branch")?.classList.contains("active")).toBe(false);
    expect(screen.getByText("新分支").closest(".sb-branch")?.classList.contains("active")).toBe(true);

    fireEvent.click(screen.getByText("Project One"));
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByText("Project One").closest(".sb-project")?.nextElementSibling?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByText("Project One"));
    await waitFor(() => expect(screen.getByText("起点")).toBeTruthy());
  });

  it("keeps previously expanded projects open when another project becomes active", async () => {
    window.api = {
      platform: "darwin",
      sessions: {
        list: vi.fn(async (projectId: string) => projectId === "project-1"
          ? [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }]
          : [{ id: "session-2", projectId: "project-2", title: "Session Two", createdAt: 1, updatedAt: 1, order: 0 }]),
      },
      canvas: {
        list: vi.fn(async (sessionId: string) => [
          {
            id: `${sessionId}-root`,
            sessionId,
            projectId: sessionId === "session-1" ? "project-1" : "project-2",
            title: sessionId === "session-1" ? "起点一" : "起点二",
            messages: [],
          },
        ]),
      },
    } as unknown as Window["api"];
    const base = ctx();
    const onSelectProject = vi.fn();
    const onFocusNode = vi.fn();
    const view = render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={{
          ...base,
          projects: [
            { id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [] },
            { id: "project-2", name: "Project Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1, sourceRoots: [] },
          ],
          sessions: [{ id: "session-1", projectId: "project-1", title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }],
        }}
        onSelectSession={vi.fn()}
        onFocusNode={onFocusNode}
        onOpenCreateProject={vi.fn()}
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

    await waitFor(() => expect(screen.getByText("起点一")).toBeTruthy());
    fireEvent.click(screen.getByText("Project Two"));
    view.rerender(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={{
          ...base,
          projects: [
            { id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [] },
            { id: "project-2", name: "Project Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1, sourceRoots: [] },
          ],
          activeProjectId: "project-2",
          activeSessionId: "session-2",
          sessions: [{ id: "session-2", projectId: "project-2", title: "Session Two", createdAt: 1, updatedAt: 1, order: 0 }],
        }}
        onSelectSession={vi.fn()}
        onFocusNode={onFocusNode}
        onOpenCreateProject={vi.fn()}
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

    await waitFor(() => expect(screen.getByText("起点二")).toBeTruthy());
    expect(screen.getByText("起点一")).toBeTruthy();
    expect(screen.getByText("Project One").closest(".sb-project")?.nextElementSibling?.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByText("Project Two").closest(".sb-project")?.nextElementSibling?.getAttribute("aria-hidden")).toBe("false");

    fireEvent.click(screen.getByText("起点一"));
    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    expect(onFocusNode).toHaveBeenCalledWith("session-1", "session-1-root");
  });

  it("prefetches inactive project node trees before expansion so project toggles can animate with content", async () => {
    window.api = {
      platform: "darwin",
      sessions: {
        list: vi.fn(async (projectId: string) => projectId === "project-2"
          ? [{ id: "session-2", projectId: "project-2", title: "Session Two", createdAt: 1, updatedAt: 1, order: 0 }]
          : []),
      },
      canvas: {
        list: vi.fn(async (sessionId: string) => [
          {
            id: `${sessionId}-root`,
            sessionId,
            projectId: "project-2",
            title: "预取起点",
            messages: [],
          },
        ]),
      },
    } as unknown as Window["api"];
    const base = ctx();

    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={{
          ...base,
          projects: [
            { id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [] },
            { id: "project-2", name: "Project Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1, sourceRoots: [] },
          ],
          sessions: [],
          activeSessionId: null,
          activeNodeId: null,
        }}
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenCreateProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onPinProject={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("预取起点")).toBeTruthy());
    expect(screen.getByText("Project Two").closest(".sb-project")?.nextElementSibling?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByText("Project Two"));
    expect(screen.getByText("Project Two").closest(".sb-project")?.nextElementSibling?.getAttribute("aria-hidden")).toBe("false");
  });

  it("groups pinned projects and delegates project open, session create, rename, delete, and pin", async () => {
    const onSelectProject = vi.fn();
    const onOpenCreateProject = vi.fn();
    const onCreateSession = vi.fn();
    const onRenameProject = vi.fn();
    const onDeleteProject = vi.fn();
    const onPinProject = vi.fn();
    window.api = {
      platform: "darwin",
      canvas: {
        list: vi.fn(async () => []),
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
        onOpenCreateProject={onOpenCreateProject}
        onRenameProject={onRenameProject}
        onDeleteProject={onDeleteProject}
        onPinProject={onPinProject}
        onSelectProject={onSelectProject}
        onCreateSession={onCreateSession}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    expect(screen.getByText("置顶")).toBeTruthy();
    expect(screen.getByText("Pinned Project")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("新建项目"));
    expect(onOpenCreateProject).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull();

    fireEvent.click(screen.getByText("Project One"));
    expect(onSelectProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Project One"));
    const regularProject = screen.getByText("Project One").closest(".sb-project") as HTMLElement;
    fireEvent.click(regularProject.querySelector('[aria-label="新建起点"]') as HTMLElement);
    expect(onCreateSession).toHaveBeenCalledWith("project-1");

    fireEvent.click(screen.getAllByLabelText("置顶")[0]);
    expect(onPinProject).toHaveBeenCalledWith("project-1", true);

    fireEvent.click(screen.getAllByLabelText("重命名")[1]);
    fireEvent.change(screen.getByDisplayValue("Project One"), { target: { value: "Renamed Project" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameProject).toHaveBeenCalledWith("project-1", "Renamed Project");

    fireEvent.click(screen.getAllByLabelText("删除")[1]);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteProject).toHaveBeenCalledWith("project-1");

    fireEvent.doubleClick(screen.getByText("Pinned Project"));
    expect(screen.queryByRole("dialog", { name: "重命名项目" })).toBeNull();
  });

  it("restores independent project/session expansion state and keeps the tree in its scroll region", async () => {
    localStorage.setItem("loom:sidebar:expanded-projects", JSON.stringify(["project-1", "deleted-project"]));
    localStorage.setItem("loom:sidebar:expanded-sessions", JSON.stringify(["session-1", "deleted-session"]));
    window.api = {
      platform: "darwin",
      canvas: {
        list: vi.fn(async () => [
          {
            id: "node-root",
            sessionId: "session-1",
            projectId: "project-1",
            title: "起点",
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
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenCreateProject={vi.fn()}
        onRenameProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onPinProject={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        theme="light"
        toggleTheme={vi.fn()}
      />,
    );

    expect(screen.getByTestId("project-tree-scroll")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("起点")).toBeTruthy());
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("loom:sidebar:expanded-projects") ?? "[]")).toEqual(["project-1"]);
      expect(JSON.parse(localStorage.getItem("loom:sidebar:expanded-sessions") ?? "[]")).toEqual(["session-1"]);
    });
  });
});
