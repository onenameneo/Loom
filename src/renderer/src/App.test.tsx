// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTurnEvent, LiveTurnSnapshot } from "./env";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspace/store";

vi.mock("./Sidebar", () => ({
  default: ({ activeSurface, setSurface, onSelectProject, onSelectSession, onFocusNode, onOpenCreateProject, toggleTheme, ctx }: any) => (
    <aside>
      <output data-testid="active-surface">{activeSurface}</output>
      <button onClick={onOpenCreateProject}>sidebar create project</button>
      <button onClick={toggleTheme}>toggle theme</button>
      <button onClick={() => setSurface("settings")}>show settings</button>
      <button onClick={() => onSelectProject?.("project-2")}>select project two</button>
      <button onClick={() => onSelectSession("session-2")}>select session two</button>
      <button onClick={() => ctx.setSessionMode("chat")}>switch current to chat</button>
      <button onClick={() => onFocusNode("session-a", "node-a1")}>focus A1</button>
      <button onClick={() => onFocusNode("session-b", "node-b1")}>focus B1</button>
    </aside>
  ),
}));
vi.mock("./canvas/CanvasLayoutContext", () => ({ CanvasLayoutProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./titlebar/Titlebar", () => ({
  TitlebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AppChrome: ({ sidebar, main }: { sidebar: React.ReactNode; main: React.ReactNode }) => <>{sidebar}{main}</>,
}));
vi.mock("./workbench/Workbench", () => ({ Workbench: () => null }));
vi.mock("./titlebar/useAppShellController", () => ({
  useAppShellController: () => ({ shell: {}, requestToggle: vi.fn(), completeTransition: vi.fn() }),
}));
vi.mock("./surfaces", () => ({
  SURFACES: [{
    id: "project",
    label: "Project",
    Panel: ({ ctx }: any) => {
      const state = useWorkspaceStore();
      const sessionTitles = (state.sessionIdsByProjectId[state.activeProjectId ?? ""] ?? [])
        .map((id) => state.sessionsById[id]?.title)
        .filter(Boolean);
      return (
        <>
          <button onClick={ctx.openCreateProject}>empty create project</button>
          <output data-testid="turn-revision">{state.turnsByNodeId["node-a"]?.revision ?? "none"}</output>
          <output data-testid="workspace-projects">{state.projectIds.map((id) => state.projectsById[id]?.name).filter(Boolean).join(",")}</output>
          <output data-testid="workspace-sessions">{sessionTitles.join(",")}</output>
          <output data-testid="active-workspace-navigation">{`${state.activeProjectId}/${state.activeSessionId}`}</output>
          <output data-testid="active-session-ui">{`${state.activeSessionId}/${state.activeNodeId}/${ctx.sessionMode}`}</output>
        </>
      );
    },
  }],
  applyActivityEvent: vi.fn(),
  getSessionViews: () => [],
  normalizeActivitySessions: <T,>(items: T) => items,
}));

import App from "./App";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetWorkspaceStore();
  delete document.documentElement.dataset.theme;
  delete (window as any).api;
});

function snapshot(revision: number): LiveTurnSnapshot {
  return {
    nodeId: "node-a",
    sessionId: "session-a",
    turnId: "turn-a",
    operation: "send",
    state: "running",
    revision,
    assistantText: revision === 3 ? "new" : "old",
  };
}

describe("App theme", () => {
  it("propagates the resolved theme to the document root and updates it after a theme change", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ resolvedTheme: "dark" })
      .mockResolvedValue({ resolvedTheme: "light" });
    const set = vi.fn(async () => undefined);
    window.api = {
      platform: "darwin",
      onMenu: vi.fn(() => vi.fn()),
      settings: { get, set },
      projects: { list: vi.fn(async () => []) },
      canvas: { onLiveTurn: vi.fn(() => vi.fn()), liveTurns: vi.fn(async () => []) },
    } as unknown as Window["api"];

    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    fireEvent.click(screen.getByRole("button", { name: "toggle theme" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });
});

describe("App live-turn initialization", () => {
  it("restores each main Session's mode when switching through child Nodes", async () => {
    window.api = {
      platform: "darwin",
      onMenu: vi.fn(() => vi.fn()),
      settings: { get: vi.fn(async () => ({ resolvedTheme: "light" })) },
      projects: { list: vi.fn(async () => [{ id: "project-1", name: "Project", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }]) },
      sessions: {
        list: vi.fn(async () => [
          { id: "session-a", projectId: "project-1", title: "A", createdAt: 1, updatedAt: 1, order: 0, ui: { activeNodeId: "node-a2", mode: "canvas" } },
          { id: "session-b", projectId: "project-1", title: "B", createdAt: 1, updatedAt: 1, order: 1, ui: { activeNodeId: "node-b1", mode: "canvas" } },
        ]),
        updateUi: vi.fn(async () => ({ ok: true })),
      },
      canvas: { onLiveTurn: vi.fn(() => vi.fn()), liveTurns: vi.fn(async () => []) },
    } as unknown as Window["api"];

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("active-session-ui").textContent).toBe("null/null/null"));
    useWorkspaceStore.getState().hydrateSessions("project-1", [
      { id: "session-a", projectId: "project-1", title: "A", createdAt: 1, updatedAt: 1, order: 0, ui: { activeNodeId: "node-a2", mode: "canvas" } },
      { id: "session-b", projectId: "project-1", title: "B", createdAt: 1, updatedAt: 1, order: 1, ui: { activeNodeId: "node-b1", mode: "canvas" } },
    ]);
    screen.getByRole("button", { name: "focus A1" }).click();
    await waitFor(() => expect(screen.getByTestId("active-session-ui").textContent).toBe("session-a/node-a1/canvas"));

    screen.getByRole("button", { name: "switch current to chat" }).click();
    await waitFor(() => expect(screen.getByTestId("active-session-ui").textContent).toBe("session-a/node-a1/chat"));
    screen.getByRole("button", { name: "focus B1" }).click();
    await waitFor(() => expect(screen.getByTestId("active-session-ui").textContent).toBe("session-b/node-b1/canvas"));
    screen.getByRole("button", { name: "focus A1" }).click();
    await waitFor(() => expect(screen.getByTestId("active-session-ui").textContent).toBe("session-a/node-a1/chat"));
  });

  it("hydrates projects and sessions into workspace state before dispatching sidebar navigation", async () => {
    window.api = {
      platform: "darwin",
      onMenu: vi.fn(() => vi.fn()),
      settings: { get: vi.fn(async () => ({ resolvedTheme: "light" })) },
      projects: {
        list: vi.fn(async () => [
          { id: "project-1", name: "Project One", createdAt: 1, updatedAt: 1, pinned: false, order: 0 },
          { id: "project-2", name: "Project Two", createdAt: 1, updatedAt: 1, pinned: false, order: 1 },
        ]),
      },
      sessions: {
        list: vi.fn(async (projectId: string) => projectId === "project-1"
          ? [{ id: "session-1", projectId, title: "Session One", createdAt: 1, updatedAt: 1, order: 0 }]
          : [{ id: "session-2", projectId, title: "Session Two", createdAt: 1, updatedAt: 1, order: 0 }]),
      },
      canvas: { onLiveTurn: vi.fn(() => vi.fn()), liveTurns: vi.fn(async () => []) },
    } as unknown as Window["api"];

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("workspace-projects").textContent).toBe("Project One,Project Two"));
    expect(screen.getByTestId("workspace-sessions").textContent).toBe("");
    expect(screen.getByTestId("active-workspace-navigation").textContent).toBe("null/null");

    screen.getByRole("button", { name: "select project two" }).click();
    await waitFor(() => expect(screen.getByTestId("workspace-sessions").textContent).toBe("Session Two"));
    screen.getByRole("button", { name: "select session two" }).click();
    await waitFor(() => expect(screen.getByTestId("active-workspace-navigation").textContent).toBe("project-2/session-2"));
  });

  it("subscribes before loading the initial list and preserves a newer event revision", async () => {
    let emit: ((event: LiveTurnEvent) => void) | undefined;
    let resolveInitial: ((items: LiveTurnSnapshot[]) => void) | undefined;
    const initialTurns = new Promise<LiveTurnSnapshot[]>((resolve) => { resolveInitial = resolve; });
    const onLiveTurn = vi.fn((listener: (event: LiveTurnEvent) => void) => {
      emit = listener;
      listener({ type: "upsert", snapshot: snapshot(3) });
      return vi.fn();
    });
    const liveTurns = vi.fn(() => initialTurns);
    window.api = {
      platform: "darwin",
      onMenu: vi.fn(() => vi.fn()),
      settings: { get: vi.fn(async () => ({ resolvedTheme: "light" })) },
      projects: { list: vi.fn(async () => []) },
      canvas: { onLiveTurn, liveTurns },
    } as unknown as Window["api"];

    render(<App />);

    await waitFor(() => expect(onLiveTurn).toHaveBeenCalledTimes(1));
    expect(liveTurns).toHaveBeenCalledTimes(1);
    expect(emit).toBeDefined();
    resolveInitial!([snapshot(2)]);

    await waitFor(() => expect(screen.getByTestId("turn-revision").textContent).toBe("3"));
  });
});

describe("App project creation flow", () => {
  function installApi({
    projects = [],
    refreshedProjects = projects,
    createdProject = { id: "project-new", name: "New Project", createdAt: 2, updatedAt: 2, pinned: false, order: 1 },
    pickedPath = "/Users/neo/code/new-project",
  }: {
    projects?: Array<{ id: string; name: string; createdAt: number; updatedAt: number; pinned: boolean; order: number }>;
    refreshedProjects?: Array<{ id: string; name: string; createdAt: number; updatedAt: number; pinned: boolean; order: number }>;
    createdProject?: { id: string; name: string; createdAt: number; updatedAt: number; pinned: boolean; order: number };
    pickedPath?: string;
  } = {}) {
    let menuListener: ((action: string) => void) | undefined;
    const create = vi.fn(async () => createdProject);
    const list = vi.fn()
      .mockResolvedValueOnce(projects)
      .mockResolvedValue(refreshedProjects);
    const pickSourceRoot = vi.fn(async () => ({ canceled: false, path: pickedPath }));
    window.api = {
      platform: "darwin",
      onMenu: vi.fn((listener) => {
        menuListener = listener;
        return vi.fn();
      }),
      settings: { get: vi.fn(async () => ({ resolvedTheme: "light" })) },
      projects: { list, create, pickSourceRoot },
      sessions: { list: vi.fn(async () => []) },
      canvas: { onLiveTurn: vi.fn(() => vi.fn()), liveTurns: vi.fn(async () => []) },
    } as unknown as Window["api"];
    return { create, list, pickSourceRoot, emitMenu: (action: string) => menuListener?.(action) };
  }

  it.each([
    ["sidebar", () => screen.getByRole("button", { name: "sidebar create project" }).click()],
    ["empty project surface", () => screen.getByRole("button", { name: "empty create project" }).click()],
    ["native menu", (_api: ReturnType<typeof installApi>) => _api.emitMenu("new-project")],
  ])("opens the sole shared dialog from the %s without creating early", async (_entry, open) => {
    const api = installApi();
    render(<App />);
    await waitFor(() => expect(api.list).toHaveBeenCalledOnce());

    open(api);

    expect(await screen.findByRole("dialog", { name: "创建项目" })).toBeTruthy();
    expect(screen.getAllByRole("dialog", { name: "创建项目" })).toHaveLength(1);
    expect(document.querySelectorAll(".project-create-dialog")).toHaveLength(1);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("resets draft state when reopened from another entry and preserves the active project across every ordinary dismiss route", async () => {
    const user = userEvent.setup();
    const project = { id: "project-1", name: "Existing", createdAt: 1, updatedAt: 1, pinned: false, order: 0 };
    useWorkspaceStore.getState().hydrateProjects([project]);
    useWorkspaceStore.getState().selectProject(project.id);
    const api = installApi({ projects: [project] });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("active-workspace-navigation").textContent).toBe("project-1/null"));

    await user.click(screen.getByRole("button", { name: "sidebar create project" }));
    await user.type(screen.getByLabelText("项目名称"), "Discard me");
    await user.click(screen.getByRole("button", { name: "添加项目目录" }));
    await screen.findByText("/Users/neo/code/new-project");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "empty create project" }));
    expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("/Users/neo/code/new-project")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "sidebar create project" }));
    const overlay = document.querySelector(".dlg-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull());

    expect(screen.getByTestId("active-workspace-navigation").textContent).toBe("project-1/null");
    expect(useWorkspaceStore.getState().activeProjectId).toBe("project-1");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("picks a folder, creates with the exact payload, refreshes, selects the result, returns to project, and closes", async () => {
    const user = userEvent.setup();
    const existing = { id: "project-1", name: "Existing", createdAt: 1, updatedAt: 1, pinned: false, order: 0 };
    const created = { id: "project-new", name: "Loom Research", createdAt: 2, updatedAt: 2, pinned: false, order: 1 };
    const api = installApi({ projects: [existing], refreshedProjects: [existing, created], createdProject: created });
    render(<App />);
    await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "show settings" }));
    expect(screen.getByTestId("active-surface").textContent).toBe("settings");

    await user.click(screen.getByRole("button", { name: "sidebar create project" }));
    await user.click(screen.getByRole("button", { name: "添加项目目录" }));
    await screen.findByText("/Users/neo/code/new-project");
    await user.clear(screen.getByLabelText("项目名称"));
    await user.type(screen.getByLabelText("项目名称"), "Loom Research");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      name: "Loom Research",
      sourceRoots: ["/Users/neo/code/new-project"],
    }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useWorkspaceStore.getState().activeProjectId).toBe("project-new"));
    expect(screen.getByTestId("workspace-projects").textContent).toBe("Existing,Loom Research");
    expect(screen.getByTestId("active-surface").textContent).toBe("project");
    expect(screen.queryByRole("dialog", { name: "创建项目" })).toBeNull();
  });
});
