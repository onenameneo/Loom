// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import type { SurfaceCtx } from "./surfaces";

afterEach(() => {
  cleanup();
  localStorage.clear();
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
  it("renders the Loom brand icon in the sidebar header", () => {
    render(
      <Sidebar
        activeSurface="project"
        setSurface={vi.fn()}
        ctx={ctx()}
        onSelectSession={vi.fn()}
        onFocusNode={vi.fn()}
        onCreateProject={vi.fn()}
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

  it("renders node trees directly under the active project without an extra session row", async () => {
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
    expect(screen.getByText("/Users/neo/code/project-one")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("起点")).toBeTruthy());
    expect(screen.queryByText("Session One")).toBeNull();
    expect(document.querySelector(".branch-dot")).toBeNull();
    expect(screen.getByText("起点").closest(".sb-root-row")?.querySelector(".sb-project-chev")).toBeNull();
    expect((screen.getByText("起点").closest(".sb-root-row") as HTMLElement).style.paddingLeft).toBe("20px");
    expect(screen.getByText("Project One").closest(".sb-project")?.classList.contains("active")).toBe(false);
    expect(screen.getByText("起点").closest(".sb-branch")?.classList.contains("active")).toBe(true);
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
        onCreateProject={vi.fn()}
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

  it("groups pinned projects and supports project create, session create, rename, delete, and pin", async () => {
    const onSelectProject = vi.fn();
    const onCreateProject = vi.fn();
    const onCreateSession = vi.fn();
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
    fireEvent.click(await screen.findByText("添加 Loom 可读取和编辑的 Source Root"));
    expect(await screen.findByRole("dialog", { name: "创建项目" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreateProject).toHaveBeenCalledWith({
      name: "project-one",
      sourceRoots: ["/Users/neo/code/project-one"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull());

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
        onCreateProject={vi.fn()}
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
