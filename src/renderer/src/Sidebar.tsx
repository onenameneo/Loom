import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Folder, FolderOpen, PanelTopClose, Pencil, Pin, Terminal, Trash2 } from "lucide-react";
import { useShallow } from "zustand/shallow";
import type { ActivityTool, AgentProc, CanvasNodeDto, ProjectMeta, SessionMeta, SettingsPayload } from "./env";
import { publishNodeUpdate, subscribeNodeUpdates } from "./canvas/nodeUpdates";
import { IconMoon, IconPlus, IconSun } from "./icons";
import { DEFAULT_ROOT_TITLE, DEFAULT_BRANCH_TITLE } from "../../common/titleDefaults";
import loomIconUrl from "../../../build/icon.png";
import {
  agentTitle,
  formatDuration,
  formatRelative,
  getSessionViews,
  isDarwinRenderer,
  kindLabel,
  livenessLabel,
  matchesAgentSession,
  sessionTitle,
  TOOL_SHORT_LABEL,
  SURFACES,
  type SurfaceCtx,
} from "./surfaces";
import { ConfirmDialog, RenameDialog, Tip } from "./ui/dialogs";
import { cn } from "./ui/styles";
import { selectProjects, selectSessionsForProject, useWorkspaceStore } from "./workspace/store";
import { useI18n } from "./i18n/I18nProvider";
import { localizedNodeTitle, localizedSessionTitle } from "./i18n/titleLabels";

const SIDEBAR_PROJECT_EXPANSION_KEY = "loom:sidebar:expanded-projects";
const SIDEBAR_SESSION_EXPANSION_KEY = "loom:sidebar:expanded-sessions";
const NODE_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;

function readStoredSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeStoredSet(key: string, value: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

// 由某会话的节点列表推导「起点→新会话」的缩进行（父子关系，深度优先）。
function outlineRows(nodes: CanvasNodeDto[]): Array<{ node: CanvasNodeDto; depth: number }> {
  const byParent = new Map<string | undefined, CanvasNodeDto[]>();
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const outline: Array<{ node: CanvasNodeDto; depth: number }> = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      outline.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return outline;
}

function SidebarNodeRow({
  nodeId,
  active,
  title,
  colorControl,
  onClick,
  paddingLeft,
  actions,
  root = false,
}: {
  nodeId: string;
  active: boolean;
  title: string;
  colorControl: ReactNode;
  onClick: () => void;
  paddingLeft?: number;
  actions?: ReactNode;
  root?: boolean;
}) {
  const liveTurn = useWorkspaceStore((state) => state.turnsByNodeId[nodeId]);
  const { t } = useI18n();
  return (
    <div
      className={`sb-session-row ${root ? "is-root" : "is-child"} ${active ? "active" : ""}`}
      style={paddingLeft ? { paddingLeft } : undefined}
    >
      {liveTurn ? (
        <span
          className="node-running-indicator"
          data-testid={`node-running-${nodeId}`}
          role="status"
          aria-label={`${title} ${t("nav.generating")}`}
          title={t("nav.generating")}
        />
      ) : colorControl}
      <button
        className={`sb-branch sb-root-row ${active ? "active" : ""}`}
        onClick={onClick}
        aria-label={title}
      >
        <span>{title}</span>
      </button>
      {actions}
    </div>
  );
}

function SidebarSessionRow({
  active,
  expanded,
  session,
  onClick,
  onToggle,
  actions,
}: {
  active: boolean;
  expanded: boolean;
  session: SessionMeta;
  onClick: () => void;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const displayTitle = localizedSessionTitle(session.title, t, session.titleState);
  return (
    <div className={`sb-session-row sb-session-header ${active ? "active" : ""}`}>
      <button
        className="sb-session-toggle grid h-7 w-5 shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-loom-faint"
        aria-label={`${expanded ? t("nav.collapse") : t("nav.expand")}${displayTitle}`}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <button className="sb-session-title min-w-0 flex-1 cursor-pointer overflow-hidden border-0 bg-transparent px-[2px] py-1 text-left text-[11px] text-loom-muted" onClick={onClick} aria-label={displayTitle}>
        <span>{displayTitle}</span>
      </button>
      {actions}
    </div>
  );
}

export default function Sidebar({
  activeSurface,
  setSurface,
  ctx,
  onSelectSession,
  onFocusNode,
  onOpenCreateProject,
  onRenameProject,
  onDeleteProject,
  onPinProject,
  onSelectProject,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onRenameNode,
  onDeleteNode,
  onSetSessionColor,
  theme,
  toggleTheme,
}: {
  activeSurface: string;
  setSurface: (id: string) => void;
  ctx: SurfaceCtx;
  onSelectSession: (id: string) => void | Promise<void>;
  onFocusNode: (sessionId: string, nodeId: string) => void;
  onOpenCreateProject: () => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onPinProject: (id: string, pinned: boolean) => void;
  onSelectProject?: (id: string) => void;
  onCreateSession?: (projectId?: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onRenameNode?: (id: string, title: string) => void;
  onDeleteNode?: (id: string) => void;
  onSetSessionColor?: (sessionId: string, nodeId: string, color: string) => void | Promise<void>;
  theme: "light" | "dark";
  toggleTheme: () => void;
  settings?: SettingsPayload | null;
}) {
  const { t } = useI18n();
  const displaySessionTitle = (session: SessionMeta) => localizedSessionTitle(session.title, t, session.titleState);
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionMeta | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionMeta | null>(null);
  const [renamingNode, setRenamingNode] = useState<CanvasNodeDto | null>(null);
  const [deletingNode, setDeletingNode] = useState<CanvasNodeDto | null>(null);
  const [projectExpanded, setProjectExpanded] = useState<Set<string>>(() => readStoredSet(SIDEBAR_PROJECT_EXPANSION_KEY));
  const [sessionExpanded, setSessionExpanded] = useState<Set<string>>(() => readStoredSet(SIDEBAR_SESSION_EXPANSION_KEY));
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["agent:claude", "agent:codex"]));
  const [sessionColorOpen, setSessionColorOpen] = useState<string | null>(null);
  const projects = useWorkspaceStore(useShallow(selectProjects));
  const sessionsById = useWorkspaceStore((state) => state.sessionsById);
  const nodesById = useWorkspaceStore((state) => state.nodesById);
  const sessionIdsByProjectId = useWorkspaceStore((state) => state.sessionIdsByProjectId);
  const nodeIdsBySessionId = useWorkspaceStore((state) => state.nodeIdsBySessionId);

  useEffect(() => subscribeNodeUpdates((update) => {
    useWorkspaceStore.getState().patchNode(update.id, {
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.color !== undefined ? { color: update.color } : {}),
    });
  }), []);

  // 活跃 Project / Session 自动展开（切到它时把层级打开）
  useEffect(() => {
    if (ctx.activeProjectId) {
      setProjectExpanded((prev) => (prev.has(ctx.activeProjectId!) ? prev : new Set(prev).add(ctx.activeProjectId!)));
    }
    if (ctx.activeSessionId) {
      setSessionExpanded((prev) => (prev.has(ctx.activeSessionId!) ? prev : new Set(prev).add(ctx.activeSessionId!)));
    }
  }, [ctx.activeProjectId, ctx.activeSessionId]);

  useEffect(() => {
    // On first mount the store is populated by the boundary bridge below. Do not
    // discard persisted expansion before that first hydration finishes.
    const validProjects = new Set([...projects, ...ctx.projects].map((project) => project.id));
    const validSessions = new Set([...Object.keys(sessionsById), ...ctx.sessions.map((session) => session.id)]);
    setProjectExpanded((prev) => new Set([...prev].filter((id) => validProjects.has(id))));
    setSessionExpanded((prev) => new Set([...prev].filter((id) => validSessions.has(id))));
  }, [projects, sessionsById]);

  useEffect(() => writeStoredSet(SIDEBAR_PROJECT_EXPANSION_KEY, projectExpanded), [projectExpanded]);
  useEffect(() => writeStoredSet(SIDEBAR_SESSION_EXPANSION_KEY, sessionExpanded), [sessionExpanded]);

  // App owns hydration. This only supports an entirely empty first mount (such
  // as an isolated preview); it must never overwrite already-normalized data
  // with a transient ctx snapshot during Project/Session navigation.
  useEffect(() => {
    const store = useWorkspaceStore.getState();
    const currentProjects = selectProjects(store);
    if (currentProjects.length === 0 && ctx.projects.length > 0) {
      store.hydrateProjects(ctx.projects);
    }
    if (ctx.activeProjectId && ctx.sessions.every((session) => session.projectId === ctx.activeProjectId)) {
      const currentSessions = selectSessionsForProject(store, ctx.activeProjectId);
      if (currentSessions.length === 0 && ctx.sessions.length > 0) {
        store.hydrateSessions(ctx.activeProjectId, ctx.sessions);
      }
    }
  }, [ctx.projects, ctx.sessions, ctx.activeProjectId]);

  useEffect(() => {
    if (!window.api?.sessions || activeSurface !== "project") return;
    let alive = true;
    Promise.all(projects.map((project) => window.api!.sessions.list(project.id).then((sessions) => [project.id, sessions] as const))).then((entries) => {
      if (!alive || entries.length === 0) return;
      const store = useWorkspaceStore.getState();
      for (const [projectId, sessions] of entries) store.hydrateSessions(projectId, sessions);
    });
    return () => {
      alive = false;
    };
  }, [activeSurface, projects, ctx.treeVersion]);

  // 会话树是共享实体数据：提前加载每个 Session 的节点，展开时不再临时创建另一份缓存。
  useEffect(() => {
    if (!window.api || activeSurface !== "project") return;
    let alive = true;
    const ids = Object.values(sessionIdsByProjectId).flat();
    Promise.all(
      ids.map((id) => window.api!.canvas.list(id).then((nodes) => [id, nodes] as const)),
    ).then((entries) => {
      if (!alive) return;
      const store = useWorkspaceStore.getState();
      for (const [sessionId, nodes] of entries) store.hydrateNodes(sessionId, nodes);
    });
    return () => {
      alive = false;
    };
  }, [sessionIdsByProjectId, activeSurface, ctx.treeVersion]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleProject = useCallback((id: string) => {
    setProjectExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSession = useCallback((id: string) => {
    setSessionExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const focusNode = useCallback((sessionId: string, nodeId: string) => {
    const session = useWorkspaceStore.getState().sessionsById[sessionId];
    if (session) {
      if (session.projectId !== ctx.activeProjectId) onSelectProject?.(session.projectId);
      setProjectExpanded((prev) => new Set(prev).add(session.projectId));
      setSessionExpanded((prev) => new Set(prev).add(sessionId));
    }
    ctx.setActiveNodeId(nodeId);
    onFocusNode(sessionId, nodeId);
  }, [ctx.activeProjectId, ctx.setActiveNodeId, onFocusNode, onSelectProject]);

  const renderNodeColor = (sessionId: string, node: CanvasNodeDto) => {
    const colorKey = `${sessionId}:${node.id}`;
    const updateColor = (color: string) => {
      void onSetSessionColor?.(sessionId, node.id, color);
      publishNodeUpdate({ id: node.id, sessionId, color: color || undefined });
      useWorkspaceStore.getState().patchNode(node.id, { color: color || undefined });
      setSessionColorOpen(null);
    };
    return (
      <div className="session-color">
        <button
          className={`color-dot ${node.color ? "is-set" : ""}`}
          style={node.color ? { background: `var(--label-${node.color})` } : undefined}
          title={t("nav.sessionColor")}
          aria-label={t("nav.branchColor", { title: localizedNodeTitle(node.title || DEFAULT_ROOT_TITLE, t, node.titleState) })}
          onClick={(event) => {
            event.stopPropagation();
            setSessionColorOpen((current) => current === colorKey ? null : colorKey);
          }}
        />
        <div className={`color-pop session-color-pop ${sessionColorOpen === colorKey ? "is-open" : ""}`}>
          <button className="color-swatch is-none" title={t("nav.noColor")} onClick={() => updateColor("")}>{!node.color && <Check size={11} />}</button>
          {NODE_COLORS.map((color) => (
            <button key={color} className="color-swatch" style={{ background: `var(--label-${color})` }} title={color} onClick={() => updateColor(color)}>
              {node.color === color && <Check size={11} />}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const createSessionForProject = useCallback((projectId: string) => {
    onCreateSession?.(projectId);
  }, [onCreateSession]);

  const agentTools: ActivityTool[] = ["claude", "codex"];
  const sessionViews = getSessionViews(ctx.activitySessions, ctx.agents, "all", ctx.activityNow);
  const supportedMonitor = isDarwinRenderer();
  const unconnectedAgents = supportedMonitor
    ? ctx.agents
        .filter((agent) => !ctx.activitySessions.some((session) => matchesAgentSession(agent, session)))
        .sort((a, b) => b.startedAt - a.startedAt)
    : [];

  const renderAgentGroup = (tool: ActivityTool) => {
    const groupId = `agent:${tool}`;
    const isExp = expanded.has(groupId);
    const sessions = sessionViews.filter((view) => view.session.tool === tool);
    const agents = unconnectedAgents.filter((agent) => agent.tool === tool);
    const ToolIcon = tool === "claude" ? Bot : Terminal;
    const count = sessions.length + agents.length;
    // 两组固定常显，让「有哪些工具」的结构一目了然；空组给一行提示。
    return (
      <Fragment key={tool}>
        <button className="sb-label sb-agent-label flex cursor-pointer items-center gap-loom-2 border-0 bg-transparent px-[9px] pb-[6px] pt-loom-4 text-[10px] font-medium uppercase tracking-[0.6px] text-loom-faint" onClick={() => toggleExpand(groupId)}>
          {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <ToolIcon size={13} />
          <span>{TOOL_SHORT_LABEL[tool]}</span>
          {count > 0 && <span className="sb-agent-count">{count}</span>}
        </button>
        {isExp && (
          <div className="sb-agent-group">
            {sessions.map(({ session, liveness }) => (
              <button
                key={session.key}
                className={`sb-agent-session ${ctx.activeSessionKey === session.key ? "active" : ""} ${liveness === "active" ? "live" : ""}`}
                onClick={() => {
                  ctx.setActiveSessionKey(session.key);
                  setSurface("observatory");
                }}
                title={session.cwd || sessionTitle(session)}
              >
                <span className={`state-dot ${liveness}`} />
                <span className="sb-agent-body">
                  <span className="sb-agent-row">
                    <span className="sb-agent-name">{sessionTitle(session)}</span>
                    <span className="sb-agent-time">{formatRelative(session.lastActiveAt, ctx.activityNow)}</span>
                  </span>
                  <span className="sb-agent-sub">
                    <span className={`sb-agent-state ${liveness}`}>{livenessLabel(liveness, t)}</span>
                    <span className="sb-agent-last">{kindLabel(session.events[session.events.length - 1]?.kind ?? "notification", t)}</span>
                  </span>
                </span>
              </button>
            ))}
            {agents.map((agent: AgentProc) => (
              <div
                className="sb-agent-session muted"
                key={agent.pid}
                title={`${agent.cwd || agentTitle(agent)} · ${t("nav.unconnectedRestart")}`}
              >
                <span className="state-dot ended" />
                <span className="sb-agent-body">
                  <span className="sb-agent-row">
                    <span className="sb-agent-name">{agentTitle(agent)}</span>
                    <span className="sb-agent-time">{formatDuration(agent.startedAt, ctx.activityNow)}</span>
                  </span>
                  <span className="sb-agent-sub">
                    <span className="sb-agent-state">{t("nav.unconnected")}</span>
                  </span>
                </span>
              </div>
            ))}
            {count === 0 && <div className="sb-agent-empty">{t("nav.noSessions")}</div>}
          </div>
        )}
      </Fragment>
    );
  };

  const renderProject = (w: ProjectMeta) => {
    const isProjectExpanded = projectExpanded.has(w.id);
    const projectSessions = (sessionIdsByProjectId[w.id] ?? [])
      .flatMap((id) => sessionsById[id] ? [sessionsById[id]] : []);
    const isProjectSelected = ctx.activeProjectId === w.id && !ctx.activeSessionId && !ctx.activeNodeId;
    return (
      <Fragment key={w.id}>
        <div
          className={cn(
            "sb-project relative flex min-h-[38px] w-full min-w-0 items-center gap-[7px] rounded-loom-sm px-[9px] py-[6px] text-[12.5px] text-loom-muted",
            "cursor-pointer hover:bg-loom-text/6 hover:text-loom-text",
            isProjectSelected && "active bg-loom-text/9 text-loom-text",
          )}
          onClick={() => {
            toggleProject(w.id);
          }}
        >
          <span className="sb-project-chev" aria-hidden="true">
            {isProjectExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
          <span className="project-name">
            {w.name}
            {w.sourceRoots?.[0] && <small>{w.sourceRoots[0]}</small>}
          </span>
          <span className="project-actions">
            <Tip label={t("nav.newRoot")}>
              <button
                className="grid size-6 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text"
                aria-label={t("nav.newRoot")}
                onClick={(e) => {
                  e.stopPropagation();
                  createSessionForProject(w.id);
                }}
              >
                <IconPlus />
              </button>
            </Tip>
            <Tip label={w.pinned ? t("nav.unpin") : t("nav.pin")}>
              <button
                className="grid size-6 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text"
                aria-label={w.pinned ? t("nav.unpin") : t("nav.pin")}
                onClick={(e) => {
                  e.stopPropagation();
                  onPinProject(w.id, !w.pinned);
                }}
              >
                <Pin size={13} fill={w.pinned ? "currentColor" : "none"} />
              </button>
            </Tip>
            <Tip label={t("nav.rename")}>
              <button
                className="grid size-6 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text"
                aria-label={t("nav.rename")}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(w);
                }}
              >
                <Pencil size={13} />
              </button>
            </Tip>
            <Tip label={t("nav.delete")}>
              <button
                className="grid size-6 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text"
                aria-label={t("nav.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleting(w);
                }}
              >
                <Trash2 size={13} />
              </button>
            </Tip>
          </span>
        </div>
        <div className={`sb-collapse ${isProjectExpanded ? "open" : ""}`} aria-hidden={!isProjectExpanded}>
          <div className="sb-collapse-inner sb-project-children">
            {ctx.activeProjectId === w.id && projectSessions.length === 0 && (
              <div className="sb-hint px-[9px] pb-[6px] pt-[2px] text-[11px] text-loom-faint">{t("nav.sessionCanvasHint")}</div>
            )}
            {projectSessions.map((session) => {
              const rows = outlineRows((nodeIdsBySessionId[session.id] ?? [])
                .flatMap((id) => nodesById[id] ? [nodesById[id]] : []));
              const activeNodeId = ctx.activeNodeId;
              return (
                <Fragment key={session.id}>
                  <SidebarSessionRow
                    active={ctx.activeSessionId === session.id && !activeNodeId}
                    expanded={sessionExpanded.has(session.id)}
                    session={session}
                    onToggle={() => toggleSession(session.id)}
                    onClick={() => toggleSession(session.id)}
                    actions={(
                      <span className="session-actions">
                        <Tip label={t("nav.rename")}><button aria-label={`${t("nav.rename")}${displaySessionTitle(session)}`} onClick={() => setRenamingSession(session)}><Pencil size={13} /></button></Tip>
                        <Tip label={t("nav.delete")}><button aria-label={`${t("nav.delete")}${displaySessionTitle(session)}`} onClick={() => setDeletingSession(session)}><Trash2 size={13} /></button></Tip>
                      </span>
                    )}
                  />
                  <div className={`sb-collapse ${sessionExpanded.has(session.id) ? "open" : ""}`} aria-hidden={!sessionExpanded.has(session.id)}>
                    <div className="sb-collapse-inner sb-outline">
                      {rows.map(({ node, depth }) => (
                        <SidebarNodeRow
                          key={node.id}
                          nodeId={node.id}
                          root={depth === 0}
                          active={ctx.activeSessionId === session.id && activeNodeId === node.id}
                          title={localizedNodeTitle(node.title || (depth === 0 ? DEFAULT_ROOT_TITLE : DEFAULT_BRANCH_TITLE), t, node.titleState)}
                          colorControl={renderNodeColor(session.id, node)}
                          paddingLeft={depth === 0 ? 16 : 28 + (depth - 1) * 12}
                          onClick={() => focusNode(session.id, node.id)}
                          actions={(
                            <span className="session-actions">
                              <Tip label={t("nav.rename")}><button aria-label={`${t("nav.rename")}${t("nav.branch")}`} onClick={() => setRenamingNode(node)}><Pencil size={13} /></button></Tip>
                              <Tip label={t("nav.delete")}><button aria-label={`${t("nav.delete")}${t("nav.branch")}`} onClick={() => setDeletingNode(node)}><Trash2 size={13} /></button></Tip>
                            </span>
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      </Fragment>
    );
  };

  const pinnedProjects = projects.filter((project) => project.pinned);
  const regularProjects = projects.filter((project) => !project.pinned);
  const collapseProjectsButton = (projects: ProjectMeta[], label: string) => {
    const projectIds = new Set(projects.map((project) => project.id));
    return (
      <Tip label={t("nav.collapseGroup", { label })}>
      <button
        className="sb-section-toggle grid size-5 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text [&>svg]:h-[15px] [&>svg]:w-[15px] [&>svg]:stroke-[1.5]"
        aria-label={t("nav.collapseGroup", { label })}
        onClick={() => {
          setProjectExpanded((current) => new Set([...current].filter((id) => !projectIds.has(id))));
          setSessionColorOpen(null);
        }}
      >
        <PanelTopClose size={15} strokeWidth={1.5} />
      </button>
    </Tip>
    );
  };

  return (
    <div className="sidebar flex h-full min-w-0 flex-1 flex-col gap-[2px] overflow-hidden px-[10px] pb-[10px] pt-[6px]">
      <div className="sb-head flex flex-none items-center gap-[9px] px-loom-2 pb-loom-3 pt-loom-2">
        <span className="sb-mark grid size-7 flex-none place-items-center overflow-hidden rounded-loom-md border border-loom-border bg-loom-surface/80">
          <img className="block size-[23px] object-contain" src={loomIconUrl} alt="Loom" draggable={false} />
        </span>
        <span className="sb-word text-[13.5px] font-semibold">
          Loom<small className="ml-[5px] text-[11px] font-normal text-loom-faint">{t("nav.brandTagline")}</small>
        </span>
        <Tip label={t("nav.toggleTheme")}>
          <button className="theme-toggle ml-auto grid size-[26px] flex-none cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-faint hover:bg-loom-text/8 hover:text-loom-text" onClick={toggleTheme}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
        </Tip>
      </div>

      {SURFACES.map((s) => {
        const badge = s.badge?.(ctx);
        return (
          <div
            key={s.id}
            className={cn(
              "sb-item flex cursor-pointer select-none items-center gap-loom-2 rounded-loom-sm px-[9px] py-[7px] text-[12.5px] text-loom-muted hover:bg-loom-text/6 hover:text-loom-text [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:stroke-current",
              activeSurface === s.id && "active bg-loom-text/8 font-medium text-loom-text",
            )}
            onClick={() => setSurface(s.id)}
          >
            <s.icon />
            {s.translationKey ? t(s.translationKey) : s.label}
            {badge != null && <span className="badge-num ml-auto font-loom-mono text-[10px] text-loom-accent">{badge}</span>}
          </div>
        );
      })}

      {activeSurface === "project" && (
        <div className="sb-tree-scroll min-h-0 min-w-0 w-full flex-1 overflow-auto pb-loom-2" data-testid="project-tree-scroll">
          {pinnedProjects.length > 0 && (
            <>
              <div className="sb-label flex items-center px-[9px] pb-2 pt-loom-4 text-[12.5px] font-semibold text-loom-faint">
                {t("nav.pinned")}
                <span className="sb-section-actions ml-auto inline-flex items-center gap-loom-1">
                  {collapseProjectsButton(pinnedProjects, t("nav.pinned"))}
                </span>
              </div>
              {pinnedProjects.map(renderProject)}
            </>
          )}
          <div className="sb-label flex items-center px-[9px] pb-2 pt-loom-4 text-[12.5px] font-semibold text-loom-faint">
            {t("nav.regularProjects")}
            <span className="sb-section-actions ml-auto inline-flex items-center gap-loom-1">
              {collapseProjectsButton(regularProjects, t("nav.regularProjects"))}
              <Tip label={t("nav.newProject")}>
                <button className="sb-add ml-0 grid size-5 cursor-pointer place-items-center rounded-loom-sm border-0 bg-transparent p-0 text-loom-muted hover:bg-loom-text/8 hover:text-loom-text [&>svg]:h-4 [&>svg]:w-4" aria-label={t("nav.newProject")} onClick={onOpenCreateProject}>
                  <IconPlus size={16} strokeWidth={1.5} />
                </button>
              </Tip>
            </span>
          </div>
          {projects.length === 0 && <div className="sb-hint px-[9px] pb-[6px] pt-[2px] text-[11px] text-loom-faint">{t("nav.noProjects")}</div>}
          {regularProjects.map(renderProject)}
        </div>
      )}

      {activeSurface === "observatory" && (
        <>
          {agentTools.map(renderAgentGroup)}
          {sessionViews.length === 0 && unconnectedAgents.length === 0 && (
            <div className="sb-hint px-[9px] pb-[6px] pt-[2px] text-[11px] text-loom-faint">{t("nav.noActivity")}</div>
          )}
        </>
      )}

      <RenameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={`${t("nav.rename")}${t("nav.project")}`}
        initial={renaming?.name ?? ""}
        onSubmit={(name) => renaming && onRenameProject(renaming.id, name)}
      />
      <RenameDialog
        open={!!renamingSession}
        onOpenChange={(o) => !o && setRenamingSession(null)}
        title={`${t("nav.rename")}${t("nav.newSession")}`}
        initial={renamingSession?.title ?? ""}
        onSubmit={(name) => renamingSession && onRenameSession?.(renamingSession.id, name)}
      />
      <RenameDialog
        open={!!renamingNode}
        onOpenChange={(o) => !o && setRenamingNode(null)}
        title={`${t("nav.rename")}${t("nav.branch")}`}
        initial={renamingNode?.title ?? ""}
        onSubmit={(name) => renamingNode && onRenameNode?.(renamingNode.id, name)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("nav.deleteProjectTitle", { name: deleting?.name ?? "" })}
        description={t("nav.deleteIrreversible")}
        onConfirm={() => {
          if (deleting) onDeleteProject(deleting.id);
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingSession}
        onOpenChange={(o) => !o && setDeletingSession(null)}
        title={t("nav.deleteSessionTitle", { name: deletingSession ? displaySessionTitle(deletingSession) : "" })}
        description={t("nav.deleteIrreversible")}
        onConfirm={() => {
          if (deletingSession) onDeleteSession?.(deletingSession.id);
          setDeletingSession(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingNode}
        onOpenChange={(o) => !o && setDeletingNode(null)}
        title={t("nav.deleteBranchTitle", { name: deletingNode?.title ?? "" })}
        description={t("nav.deleteBranchDesc")}
        onConfirm={() => {
          if (deletingNode) onDeleteNode?.(deletingNode.id);
          setDeletingNode(null);
        }}
      />
    </div>
  );
}
