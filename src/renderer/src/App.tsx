import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import type { ActivitySession, ActivityStatus, ActivityTool, AgentProc, BranchSource, ProjectMeta, SessionMeta, SettingsPayload } from "./env";
import Sidebar from "./Sidebar";
import { CanvasLayoutProvider } from "./canvas/CanvasLayoutContext";
import { AppChrome, TitlebarProvider } from "./titlebar/Titlebar";
import { Workbench } from "./workbench/Workbench";
import { CreateProjectDialog, Modal } from "./ui/dialogs";
import { buttonClassName } from "./ui/styles";
import { isBrowserSidebarShortcut } from "./titlebar/sidebarState";
import { useAppShellController } from "./titlebar/useAppShellController";
import {
  applyActivityEvent,
  getSessionViews,
  normalizeActivitySessions,
  SURFACES,
  type SurfaceCtx,
} from "./surfaces";
import {
  selectProjects,
  selectSessionsForProject,
  useWorkspaceStore,
} from "./workspace/store";
import { connectLiveTurnBridge } from "./workspace/liveTurnBridge";
import { connectTodoPlanBridge } from "./workspace/todoPlanBridge";
import { connectApprovalBridge } from "./workspace/approvalBridge";
import { ApprovalCenter } from "./workspace/ApprovalCenter";
import { useI18n } from "./i18n/I18nProvider";
import { readStoredSettingsSection, SETTINGS_SECTION_STORAGE_KEY, type SettingsSectionId } from "./settings/settingsNavigation";

export default function App() {
  const { t } = useI18n();
  const [activeSurface, setActiveSurface] = useState("project");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(readStoredSettingsSection);
  const [settingsSectionState, setSettingsSectionState] = useState<import("./surfaces").SettingsSectionState | null>(null);
  const [pendingSettingsSection, setPendingSettingsSection] = useState<SettingsSectionId | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const projects = useWorkspaceStore(useShallow(selectProjects));
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId);
  const sessions = useWorkspaceStore(useShallow((state) => selectSessionsForProject(state, state.activeProjectId)));
  const activeSessionId = useWorkspaceStore((state) => state.activeSessionId);
  const activeNodeId = useWorkspaceStore((state) => state.activeNodeId);
  const hydrateProjects = useWorkspaceStore((state) => state.hydrateProjects);
  const hydrateSessions = useWorkspaceStore((state) => state.hydrateSessions);
  const selectProject = useWorkspaceStore((state) => state.selectProject);
  const selectSession = useWorkspaceStore((state) => state.selectSession);
  const selectNode = useWorkspaceStore((state) => state.selectNode);
  const [sessionMode, setSessionMode] = useState<"chat" | "canvas" | null>(null);
  const [focusMessageSeq, setFocusMessageSeq] = useState<number | null>(null);
  const sessionUiStateRef = useRef(new Map<string, { nodeId: string | null; mode: "chat" | "canvas" | null }>());
  const previousSessionIdRef = useRef<string | null>(null);
  const sessionLoadRequestRef = useRef(0);
  const pendingProjectIdRef = useRef<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [agents, setAgents] = useState<AgentProc[]>([]);
  const [activitySessions, setActivitySessions] = useState<ActivitySession[]>([]);
  const [activityStatus, setActivityStatus] = useState<ActivityStatus | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [activityNow, setActivityNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(() => localStorage.getItem("loom:workbench:open") === "1");
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
        skills: { globalSources: [] },
        permissions: {
          profile: "auto-edit",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          networkAccess: false,
          writableRoots: [],
          commandOutputLimit: 64_000,
        },
        memory: { enabled: false, backgroundExtraction: false, autoDream: false },
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
      hydrateProjects(demo);
      return demo;
    }
    const list = await window.api.projects.list();
    hydrateProjects(list);
    return list;
  }, [hydrateProjects]);

  const reloadSessions = useCallback(async (projectId: string | null = activeProjectId) => {
    const requestId = ++sessionLoadRequestRef.current;
    if (!projectId) {
      return [];
    }
    if (!window.api) {
      const demo: SessionMeta[] = [
        { id: `${projectId}:session-main`, projectId, title: "新会话", createdAt: 0, updatedAt: 0, order: 0 },
        { id: `${projectId}:session-notes`, projectId, title: "实验记录", createdAt: 0, updatedAt: 0, order: 1 },
      ];
      hydrateSessions(projectId, demo);
      return demo;
    }
    const list = await window.api.sessions.list(projectId);
    if (requestId !== sessionLoadRequestRef.current) return list;
    hydrateSessions(projectId, list);
    return list;
  }, [activeProjectId, hydrateSessions]);

  useEffect(() => {
    reloadSettings();
    reloadProjects();
  }, [reloadSettings, reloadProjects]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    reloadSessions(activeProjectId);
  }, [activeProjectId, reloadSessions]);

  useEffect(() => {
    const previous = previousSessionIdRef.current;
    if (activeSessionId && previous !== activeSessionId) {
      const saved = sessionUiStateRef.current.get(activeSessionId);
      const persisted = useWorkspaceStore.getState().sessionsById[activeSessionId]?.ui;
      selectNode(saved?.nodeId ?? persisted?.activeNodeId ?? null);
      setSessionMode(saved?.mode ?? persisted?.mode ?? null);
    }
    previousSessionIdRef.current = activeSessionId;
  }, [activeSessionId, selectNode]);

  const updateSessionUi = useCallback((patch: { activeNodeId?: string; mode?: "chat" | "canvas" }) => {
    const updateUi = window.api?.sessions?.updateUi;
    if (!activeSessionId || !updateUi) return;
    void updateUi(activeSessionId, patch);
  }, [activeSessionId]);

  const setPersistedSessionMode = useCallback((mode: "chat" | "canvas") => {
    setSessionMode(mode);
    if (activeSessionId) {
      sessionUiStateRef.current.set(activeSessionId, {
        nodeId: useWorkspaceStore.getState().activeNodeId,
        mode,
      });
    }
    updateSessionUi({ mode });
  }, [activeSessionId, updateSessionUi]);

  const setPersistedActiveNode = useCallback((nodeId: string | null) => {
    selectNode(nodeId);
    if (activeSessionId && nodeId) {
      const remembered = sessionUiStateRef.current.get(activeSessionId);
      const persisted = useWorkspaceStore.getState().sessionsById[activeSessionId]?.ui;
      sessionUiStateRef.current.set(activeSessionId, {
        nodeId,
        mode: sessionMode ?? remembered?.mode ?? persisted?.mode ?? null,
      });
      updateSessionUi({ activeNodeId: nodeId });
    }
  }, [activeSessionId, selectNode, sessionMode, updateSessionUi]);

  useEffect(() => {
    const updateUi = window.api?.projects?.updateUi;
    if (activeProjectId && activeSessionId && updateUi) {
      void updateUi(activeProjectId, { activeSessionId });
    }
  }, [activeProjectId, activeSessionId]);

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

  useEffect(() => {
    if (!window.api?.canvas) return;
    const stopLive = connectLiveTurnBridge(window.api.canvas);
    const stopTodo = connectTodoPlanBridge(window.api.canvas);
    const approvalApi = window.api.canvas as unknown as { onApproval?: typeof window.api.canvas.onApproval; listApprovals?: typeof window.api.canvas.listApprovals };
    const stopApproval = typeof approvalApi.onApproval === "function" && typeof approvalApi.listApprovals === "function"
      ? connectApprovalBridge(approvalApi as Required<typeof approvalApi>)
      : () => undefined;
    return () => { stopLive(); stopTodo(); stopApproval(); };
  }, []);

  const refreshActivityStatus = useCallback(async () => {
    if (!window.api?.activity) return;
    setActivityStatus(await window.api.activity.status());
  }, []);

  const runActivityConfig = useCallback(async (action: "enable" | "disable", tool: ActivityTool) => {
    if (!window.api?.activity) return;
    const result = await window.api.activity[action]({ tools: [tool] });
    setActivityStatus(result.status);
  }, []);

  const createProject = useCallback(async (input?: { name?: string; sourceRoots?: string[] }) => {
    if (!window.api) return;
    const project = await window.api.projects.create(input);
    await reloadProjects();
    selectProject(project.id);
    setActiveSurface("project");
  }, [reloadProjects, selectProject]);

  const openCreateProject = useCallback(() => {
    setCreateProjectOpen(true);
  }, []);

  const pickProjectFolder = useCallback(async () => {
    const picker = window.api?.projects?.pickSourceRoot ?? window.api?.acp?.pickDir;
    if (!picker) throw new Error("当前窗口未暴露目录选择器，请重启应用后再试。");
    const result = await picker();
    return result.canceled || !result.path ? undefined : result.path;
  }, []);

  const createSession = useCallback(async (projectId?: string) => {
    const targetProjectId = projectId ?? activeProjectId;
    if (!window.api || !targetProjectId) return;
    const session = await window.api.sessions.create(targetProjectId);
    await reloadSessions(targetProjectId);
    selectProject(targetProjectId);
    selectSession(session.id);
    setActiveSurface("project");
  }, [activeProjectId, reloadSessions, selectProject, selectSession]);

  const createChatBranch = useCallback(async (sourceNodeId: string, sourceSeq: number) => {
    if (!window.api) return;
    const result = await window.api.canvas.branchFromMessage({ nodeId: sourceNodeId, sourceSeq, mode: "new-session" });
    if (!result.ok || !result.sessionId) throw new Error(result.reason ?? "创建新聊天分支失败");
    const projectId = result.source?.projectId ?? activeProjectId;
    if (projectId) {
      await reloadSessions(projectId);
      selectProject(projectId);
    }
    sessionUiStateRef.current.set(result.sessionId, { nodeId: result.nodeId ?? null, mode: "chat" });
    setFocusMessageSeq(null);
    selectSession(result.sessionId);
    setSessionMode("chat");
    selectNode(result.nodeId ?? null);
    setActiveSurface("project");
  }, [activeProjectId, reloadSessions, selectNode, selectProject, selectSession]);

  const returnToBranchSource = useCallback(async (source: BranchSource) => {
    const sourceSessions = await reloadSessions(source.projectId);
    // A source session may have been deleted after this branch was created.
    // Keep the derived chat usable instead of navigating to an empty surface.
    if (!sourceSessions.some((session) => session.id === source.sessionId)) return;
    selectProject(source.projectId);
    sessionUiStateRef.current.set(source.sessionId, { nodeId: source.nodeId, mode: "chat" });
    selectSession(source.sessionId);
    setSessionMode("chat");
    selectNode(source.nodeId);
    setFocusMessageSeq(source.messageSeq);
    setActiveSurface("project");
  }, [reloadSessions, selectNode, selectProject, selectSession]);

  // 原生菜单动作
  useEffect(() => {
    if (!window.api) return;
    return window.api.onMenu((action) => {
      if (action === "new-project") openCreateProject();
      else if (action === "new-session") createSession();
      else if (action === "settings") setActiveSurface("settings");
      else if (action === "surface:project") setActiveSurface("project");
      else if (action === "surface:observatory") setActiveSurface("observatory");
      else if (action === "surface:memory") {
        setActiveSettingsSection("memory");
        localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, "memory");
        setActiveSurface("settings");
      }
      else if (action === "toggle-sidebar") shellController.requestToggle("menu");
    });
  }, [createSession, openCreateProject, shellController.requestToggle]);

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

  const bumpProjectTree = useCallback(() => {
    setTreeVersion((v) => v + 1);
    if (activeProjectId) void reloadSessions(activeProjectId);
  }, [activeProjectId, reloadSessions]);

  const commitSettingsSection = useCallback((section: SettingsSectionId) => {
    setActiveSettingsSection(section);
    localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
    setSettingsSectionState(null);
    setPendingSettingsSection(null);
  }, []);

  const selectSettingsSection = useCallback((section: SettingsSectionId) => {
    if (section === activeSettingsSection) return;
    if (settingsSectionState?.dirty) {
      setPendingSettingsSection(section);
      return;
    }
    commitSettingsSection(section);
  }, [activeSettingsSection, commitSettingsSection, settingsSectionState]);

  const ctx: SurfaceCtx = {
    projects,
    sessions,
    activeProjectId,
    activeSessionId,
    openCreateProject,
    createSession,
    goSettings: () => setActiveSurface("settings"),
    settings,
    reloadSettings,
    theme,
    activeNodeId,
    setActiveNodeId: setPersistedActiveNode,
    sessionMode,
    setSessionMode: setPersistedSessionMode,
    focusMessageSeq,
    treeVersion,
    bumpTreeVersion: bumpProjectTree,
    agentCount: agents.length,
    activitySessions,
    agents,
    activityStatus,
    activeSessionKey,
    setActiveSessionKey,
    activityNow,
    refreshActivityStatus,
    runActivityConfig,
    createChatBranch,
    returnToBranchSource,
    settingsSection: activeSettingsSection,
    setSettingsSection: selectSettingsSection,
    setSettingsSectionState,
  };

  const Active = SURFACES.find((s) => s.id === activeSurface) ?? SURFACES[0];
  const defaultTitlebar = useMemo(() => ({ title: Active.translationKey ? t(Active.translationKey) : Active.label }), [Active.label, Active.translationKey, t]);
  const platform = window.api?.platform ?? "browser";
  useEffect(() => localStorage.setItem("loom:workbench:open", workbenchOpen ? "1" : "0"), [workbenchOpen]);

  return (
    <TitlebarProvider defaultDescriptor={defaultTitlebar}>
      <CanvasLayoutProvider>
        <div className="app" data-platform={platform}>
          <div id="app-overlay-root" className="app-overlay-root chrome-no-drag" />
          <ApprovalCenter />
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
                onSelectSession={async (id) => {
                  setFocusMessageSeq(null);
                  selectSession(id);
                  if (sessionMode !== "canvas") {
                    return;
                  }
                  const nodes = window.api ? await window.api.canvas.list(id) : [];
                  const root = nodes.find((node) => !node.parentId) ?? nodes[0];
                  selectNode(root?.id ?? null);
                }}
                onFocusNode={(sessionId, nodeId) => {
                  setFocusMessageSeq(null);
                  const session = useWorkspaceStore.getState().sessionsById[sessionId];
                  const remembered = sessionUiStateRef.current.get(sessionId);
                  const nextMode = sessionId === activeSessionId
                    ? sessionMode ?? remembered?.mode ?? session?.ui?.mode ?? "chat"
                    : remembered?.mode ?? session?.ui?.mode ?? "chat";
                  sessionUiStateRef.current.set(sessionId, { nodeId, mode: nextMode });
                  const nextProjectId = session?.projectId ?? pendingProjectIdRef.current;
                  pendingProjectIdRef.current = null;
                  if (nextProjectId) selectProject(nextProjectId);
                  selectSession(sessionId);
                  setSessionMode(nextMode);
                  void window.api?.sessions?.updateUi?.(sessionId, { activeNodeId: nodeId, mode: nextMode });
                  setActiveSurface("project");
                  selectNode(nodeId);
                }}
                onOpenCreateProject={openCreateProject}
                onRenameProject={async (id, name) => {
                  await window.api.projects.rename(id, name);
                  reloadProjects();
                }}
                onDeleteProject={async (id) => {
                  await window.api.projects.delete(id);
                  reloadProjects();
                }}
                onPinProject={async (id, pinned) => {
                  await window.api.projects.pin(id, pinned);
                  reloadProjects();
                }}
                onSelectProject={(id) => {
                  pendingProjectIdRef.current = id;
                  selectProject(id);
                }}
                onCreateSession={createSession}
                onRenameSession={async (id, title) => {
                  await window.api.sessions.rename(id, title);
                  reloadSessions(activeProjectId);
                }}
                onDeleteSession={async (id) => {
                  const session = useWorkspaceStore.getState().sessionsById[id];
                  await window.api.sessions.delete(id);
                  if (session?.projectId) await reloadSessions(session.projectId);
                  setTreeVersion((version) => version + 1);
                }}
                onRenameNode={async (id, title) => {
                  if (window.api) await window.api.canvas.update(id, { title });
                  setTreeVersion((version) => version + 1);
                }}
                onDeleteNode={async (id) => {
                  if (window.api) await window.api.canvas.delete(id);
                  if (activeNodeId === id) selectNode(null);
                  setTreeVersion((version) => version + 1);
                }}
                onSetSessionColor={async (_sessionId, nodeId, color) => {
                  if (window.api) await window.api.canvas.update(nodeId, { color });
                  bumpProjectTree();
                }}
                theme={theme}
                toggleTheme={toggleTheme}
                settings={settings}
              />
            }
            main={
              <Active.Panel ctx={ctx} />
            }
            right={<Workbench nodeId={activeNodeId} projectId={activeProjectId} />}
            workbenchOpen={workbenchOpen}
            onToggleWorkbench={() => setWorkbenchOpen((open) => !open)}
          />
          <CreateProjectDialog
            open={createProjectOpen}
            onOpenChange={setCreateProjectOpen}
            onPickFolder={pickProjectFolder}
            onSubmit={createProject}
          />
          <Modal open={Boolean(pendingSettingsSection)} onOpenChange={(open) => { if (!open) setPendingSettingsSection(null); }} ariaLabel={t("settings.unsavedTitle")}>
            <div className="settings-modal__panel settings-unsaved-dialog">
              <div className="settings-modal__head"><h3>{t("settings.unsavedTitle")}</h3></div>
              <p className="settings-help">{t("settings.unsavedBody")}</p>
              <div className="settings-unsaved-dialog__actions">
                <button className={buttonClassName()} type="button" onClick={() => setPendingSettingsSection(null)}>{t("common.cancel")}</button>
                <button className={buttonClassName("danger")} type="button" onClick={() => { settingsSectionState?.discard(); if (pendingSettingsSection) commitSettingsSection(pendingSettingsSection); }}>{t("settings.discardChanges")}</button>
                <button className={buttonClassName("primary")} type="button" onClick={async () => { if (!settingsSectionState || !pendingSettingsSection) return; const ok = await settingsSectionState.save(); if (ok) commitSettingsSection(pendingSettingsSection); }}>{t("settings.saveAndSwitch")}</button>
              </div>
            </div>
          </Modal>
        </div>
      </CanvasLayoutProvider>
    </TitlebarProvider>
  );
}
