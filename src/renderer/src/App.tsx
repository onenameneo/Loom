import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySession, ActivityStatus, ActivityTool, AgentProc, ProjectMeta, SessionMeta, SettingsPayload } from "./env";
import Sidebar from "./Sidebar";
import { CanvasLayoutProvider } from "./canvas/CanvasLayoutContext";
import { AppChrome, TitlebarProvider } from "./titlebar/Titlebar";
import { isBrowserSidebarShortcut } from "./titlebar/sidebarState";
import { useAppShellController } from "./titlebar/useAppShellController";
import {
  applyActivityEvent,
  getSessionViews,
  normalizeActivitySessions,
  SURFACES,
  type SurfaceCtx,
} from "./surfaces";

export default function App() {
  const [activeSurface, setActiveSurface] = useState("workspace");
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [chatNodeId, setChatNodeId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"chat" | "canvas">("chat");
  const sessionUiStateRef = useRef(new Map<string, { focusNodeId: string | null; chatNodeId: string | null; mode: "chat" | "canvas" }>());
  const previousSessionIdRef = useRef<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [agents, setAgents] = useState<AgentProc[]>([]);
  const [activitySessions, setActivitySessions] = useState<ActivitySession[]>([]);
  const [activityStatus, setActivityStatus] = useState<ActivityStatus | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [activityNow, setActivityNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const shellController = useAppShellController({
    toggleRef: sidebarToggleRef,
    sidebarContentRef,
  });

  const reloadSettings = useCallback(async () => {
    if (!window.api) {
      // 浏览器预览（无 Electron 桥）：用假数据渲染外壳
      setSettings({
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "light", density: "comfortable" },
        monitor: { notify: true },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        keyStorage: "local",
        resolvedModel: "claude-sonnet-4-5",
        resolvedTheme: "light",
      });
      setTheme("light");
      return;
    }
    const s = await window.api.settings.get();
    setSettings(s);
    setTheme(s.resolvedTheme);
  }, []);

  const reloadProjects = useCallback(async () => {
    if (!window.api) {
      const demo: ProjectMeta[] = [
        { id: "project_demo", name: "理解 Transformer", createdAt: 0, updatedAt: 0, pinned: true, order: 0 },
        { id: "project_demo2", name: "freqtrade 策略研究", createdAt: 0, updatedAt: 0, pinned: false, order: 1 },
      ];
      setProjects(demo);
      setActiveProjectId((cur) => cur ?? demo[0].id);
      return demo;
    }
    const list = await window.api.projects.list();
    setProjects(list);
    setActiveProjectId((cur) => cur ?? list[0]?.id ?? null);
    return list;
  }, []);

  const reloadSessions = useCallback(async (projectId: string | null = activeProjectId) => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      return [];
    }
    if (!window.api) {
      const demo: SessionMeta[] = [
        { id: `${projectId}:session-main`, projectId, title: "默认会话", createdAt: 0, updatedAt: 0, order: 0 },
        { id: `${projectId}:session-notes`, projectId, title: "实验分支", createdAt: 0, updatedAt: 0, order: 1 },
      ];
      setSessions(demo);
      setActiveSessionId((cur) => (cur && demo.some((s) => s.id === cur) ? cur : demo[0]?.id ?? null));
      return demo;
    }
    const list = await window.api.sessions.list(projectId);
    setSessions(list);
    setActiveSessionId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
    return list;
  }, [activeProjectId]);

  useEffect(() => {
    reloadSettings();
    reloadProjects();
  }, [reloadSettings, reloadProjects]);

  useEffect(() => {
    reloadSessions(activeProjectId);
  }, [activeProjectId, reloadSessions]);

  useEffect(() => {
    const previous = previousSessionIdRef.current;
    if (previous && previous !== activeSessionId) {
      sessionUiStateRef.current.set(previous, { focusNodeId, chatNodeId, mode: workspaceMode });
    }
    if (activeSessionId && previous !== activeSessionId) {
      const saved = sessionUiStateRef.current.get(activeSessionId);
      setFocusNodeId(saved?.focusNodeId ?? null);
      setChatNodeId(saved?.chatNodeId ?? null);
      setWorkspaceMode(saved?.mode ?? "chat");
    }
    previousSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!window.api?.monitor) return;
    let cancelled = false;
    window.api.monitor.list().then((agents) => {
      if (!cancelled) setAgents(agents);
    });
    const off = window.api.monitor.onEvent((event) => setAgents(event.agents));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (!window.api?.activity) return;
    let cancelled = false;
    Promise.all([window.api.activity.list(), window.api.activity.status()]).then(([list, nextStatus]) => {
      if (cancelled) return;
      setActivitySessions(normalizeActivitySessions(list));
      setActivityStatus(nextStatus);
    });
    const off = window.api.activity.onEvent((event) => {
      setActivitySessions((list) => applyActivityEvent(normalizeActivitySessions(list), event));
      setActiveSessionKey((key) => key ?? `${event.tool}:${event.sessionId}`);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setActivityNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // 全屏进出：macOS 全屏后无红绿灯，通知 chrome 调整开关位置。
  useEffect(() => {
    if (!window.api?.onFullScreen) return;
    return window.api.onFullScreen(setFullscreen);
  }, []);

  useEffect(() => {
    const views = getSessionViews(activitySessions, agents, "all", activityNow);
    if (activeSessionKey && views.some((view) => view.session.key === activeSessionKey)) return;
    setActiveSessionKey(views[0]?.session.key ?? null);
  }, [activeSessionKey, activityNow, activitySessions, agents]);

  const refreshActivityStatus = useCallback(async () => {
    if (!window.api?.activity) return;
    setActivityStatus(await window.api.activity.status());
  }, []);

  const runActivityConfig = useCallback(async (action: "enable" | "disable", tool: ActivityTool) => {
    if (!window.api?.activity) return;
    const result = await window.api.activity[action]({ tools: [tool] });
    setActivityStatus(result.status);
  }, []);

  const createProject = useCallback(async (input?: { name?: string; sourceFolders?: string[] }) => {
    if (!window.api) return;
    const project = await window.api.projects.create(input);
    await reloadProjects();
    setActiveProjectId(project.id);
    setActiveSurface("workspace");
  }, [reloadProjects]);

  const createSession = useCallback(async () => {
    if (!window.api || !activeProjectId) return;
    const session = await window.api.sessions.create(activeProjectId);
    await reloadSessions(activeProjectId);
    setActiveSessionId(session.id);
    setFocusNodeId(null);
    setChatNodeId(null);
    setActiveSurface("workspace");
  }, [activeProjectId, reloadSessions]);

  const createWorkspace = createProject;

  // 原生菜单动作
  useEffect(() => {
    if (!window.api) return;
    return window.api.onMenu((action) => {
      if (action === "new-project" || action === "new-workspace") createProject();
      else if (action === "new-session") createSession();
      else if (action === "settings") setActiveSurface("settings");
      else if (action === "surface:workspace") setActiveSurface("workspace");
      else if (action === "surface:observatory") setActiveSurface("observatory");
      else if (action === "toggle-sidebar") shellController.requestToggle("menu");
    });
  }, [createProject, createSession, shellController.requestToggle]);

  useEffect(() => {
    if (window.api) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBrowserSidebarShortcut(event)) return;
      event.preventDefault();
      shellController.requestToggle("browser");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shellController.requestToggle]);

  const toggleTheme = useCallback(async () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (!window.api) return;
    await window.api.settings.set({ appearance: { theme: next } });
    reloadSettings();
  }, [theme, reloadSettings]);

  const ctx: SurfaceCtx = {
    workspaces: projects,
    projects,
    sessions,
    activeWorkspaceId: activeSessionId,
    activeProjectId,
    activeSessionId,
    createWorkspace,
    createProject,
    createSession,
    goSettings: () => setActiveSurface("settings"),
    settings,
    reloadSettings,
    theme,
    focusNodeId,
    clearFocusNode: () => setFocusNodeId(null),
    chatNodeId,
    setChatNodeId,
    workspaceMode,
    setWorkspaceMode,
    treeVersion,
    bumpTreeVersion: () => setTreeVersion((v) => v + 1),
    agentCount: agents.length,
    activitySessions,
    agents,
    activityStatus,
    activeSessionKey,
    setActiveSessionKey,
    activityNow,
    refreshActivityStatus,
    runActivityConfig,
  };

  const Active = SURFACES.find((s) => s.id === activeSurface) ?? SURFACES[0];
  const defaultTitlebar = useMemo(() => ({ title: Active.label }), [Active.label]);
  const platform = window.api?.platform ?? "browser";

  return (
    <TitlebarProvider defaultDescriptor={defaultTitlebar}>
      <CanvasLayoutProvider>
        <div className="app" data-theme={theme} data-platform={platform}>
          <div id="app-overlay-root" className="app-overlay-root chrome-no-drag" />
          <div className="wallpaper" />
          <AppChrome
            shell={shellController.shell}
            platform={platform}
            fullscreen={fullscreen}
            toggleRef={sidebarToggleRef}
            sidebarContentRef={sidebarContentRef}
            onToggleSidebar={() => shellController.requestToggle("button")}
            onTransitionComplete={shellController.completeTransition}
            sidebar={
              <Sidebar
                activeSurface={activeSurface}
                setSurface={setActiveSurface}
                ctx={ctx}
                onSelectWorkspace={async (id) => {
                  setActiveSessionId(id);
                  if (workspaceMode !== "canvas") {
                    setFocusNodeId(null);
                    setChatNodeId(null);
                    return;
                  }
                  const nodes = window.api ? await window.api.canvas.list(id) : [];
                  const root = nodes.find((node) => !node.parentId) ?? nodes[0];
                  setFocusNodeId(root?.id ?? null);
                }}
                onFocusNode={(workspaceId, nodeId) => {
                  setActiveSessionId(workspaceId);
                  setActiveSurface("workspace");
                  if (workspaceMode === "canvas") {
                    setFocusNodeId(nodeId);
                  } else {
                    setChatNodeId(nodeId);
                    setFocusNodeId(null);
                  }
                }}
                onCreateWorkspace={createWorkspace}
                onRenameWorkspace={async (id, name) => {
                  await window.api.projects.rename(id, name);
                  reloadProjects();
                }}
                onDeleteWorkspace={async (id) => {
                  await window.api.projects.delete(id);
                  setActiveProjectId((cur) => (cur === id ? null : cur));
                  reloadProjects();
                }}
                onPinWorkspace={async (id, pinned) => {
                  await window.api.projects.pin(id, pinned);
                  reloadProjects();
                }}
                onSelectProject={(id) => setActiveProjectId(id)}
                onCreateSession={createSession}
                onRenameSession={async (id, title) => {
                  await window.api.sessions.rename(id, title);
                  reloadSessions(activeProjectId);
                }}
                onDeleteSession={async (id) => {
                  await window.api.sessions.delete(id);
                  setActiveSessionId((cur) => (cur === id ? null : cur));
                  reloadSessions(activeProjectId);
                }}
                theme={theme}
                toggleTheme={toggleTheme}
                settings={settings}
              />
            }
            main={
              <Active.Panel ctx={ctx} />
            }
          />
        </div>
      </CanvasLayoutProvider>
    </TitlebarProvider>
  );
}
