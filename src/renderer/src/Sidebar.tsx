import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Folder, FolderOpen, PanelTopClose, Pencil, Pin, Terminal, Trash2 } from "lucide-react";
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
  LIVENESS_LABEL,
  matchesAgentSession,
  sessionTitle,
  TOOL_SHORT_LABEL,
  SURFACES,
  type SurfaceCtx,
} from "./surfaces";
import { ConfirmDialog, CreateProjectDialog, RenameDialog, Tip } from "./ui/dialogs";

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
  active,
  title,
  colorControl,
  onClick,
  paddingLeft,
  actions,
  root = false,
}: {
  active: boolean;
  title: string;
  colorControl: ReactNode;
  onClick: () => void;
  paddingLeft?: number;
  actions?: ReactNode;
  root?: boolean;
}) {
  return (
    <div
      className={`sb-session-row ${root ? "is-root" : "is-child"} ${active ? "active" : ""}`}
      style={!root && paddingLeft ? { paddingLeft } : undefined}
    >
      {colorControl}
      <button
        className={`sb-branch sb-root-row ${active ? "active" : ""}`}
        style={root ? { paddingLeft: 20 } : undefined}
        onClick={onClick}
        aria-label={title}
      >
        <span>{title}</span>
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
  onCreateProject,
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
  onCreateProject: (input?: { name?: string; sourceRoots?: string[] }) => void | Promise<void>;
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
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [renamingSession, setRenamingSession] = useState<SessionMeta | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionMeta | null>(null);
  const [renamingNode, setRenamingNode] = useState<CanvasNodeDto | null>(null);
  const [deletingNode, setDeletingNode] = useState<CanvasNodeDto | null>(null);
  const [projectExpanded, setProjectExpanded] = useState<Set<string>>(() => readStoredSet(SIDEBAR_PROJECT_EXPANSION_KEY));
  const [sessionExpanded, setSessionExpanded] = useState<Set<string>>(() => readStoredSet(SIDEBAR_SESSION_EXPANSION_KEY));
  const [projectSessionsByProject, setProjectSessionsByProject] = useState<Record<string, SessionMeta[]>>({});
  // 每个会话独立展开：sessionExpanded 记哪些会话展开，outlines 存各自的节点列表。
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["agent:claude", "agent:codex"]));
  const [outlines, setOutlines] = useState<Record<string, CanvasNodeDto[]>>({});
  const [sessionColorOpen, setSessionColorOpen] = useState<string | null>(null);

  useEffect(() => subscribeNodeUpdates((update) => {
    setOutlines((current) => ({
      ...current,
      [update.sessionId]: (current[update.sessionId] ?? []).map((node) =>
        node.id === update.id
          ? { ...node, ...(update.title !== undefined ? { title: update.title } : {}), ...(update.color !== undefined ? { color: update.color } : {}) }
          : node,
      ),
    }));
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
    const validProjects = new Set(ctx.projects.map((project) => project.id));
    const validSessions = new Set(ctx.sessions.map((session) => session.id));
    setProjectExpanded((prev) => new Set([...prev].filter((id) => validProjects.has(id))));
    setSessionExpanded((prev) => new Set([...prev].filter((id) => validSessions.has(id))));
    setProjectSessionsByProject((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => validProjects.has(id))));
  }, [ctx.projects, ctx.sessions]);

  useEffect(() => writeStoredSet(SIDEBAR_PROJECT_EXPANSION_KEY, projectExpanded), [projectExpanded]);
  useEffect(() => writeStoredSet(SIDEBAR_SESSION_EXPANSION_KEY, sessionExpanded), [sessionExpanded]);

  useEffect(() => {
    if (!ctx.activeProjectId) return;
    // 切换项目时 ctx.sessions 可能暂时还保留上一个项目的数据；不要用这份旧列表覆盖目标项目缓存。
    if (ctx.sessions.some((session) => session.projectId !== ctx.activeProjectId)) return;
    setProjectSessionsByProject((prev) => ({ ...prev, [ctx.activeProjectId!]: ctx.sessions }));
  }, [ctx.activeProjectId, ctx.sessions]);

  useEffect(() => {
    if (!window.api?.sessions || activeSurface !== "project") return;
    let alive = true;
    const validProjects = new Set(ctx.projects.map((project) => project.id));
    const ids = ctx.projects.map((project) => project.id).filter((id) => validProjects.has(id) && id !== ctx.activeProjectId);
    Promise.all(ids.map((id) => window.api!.sessions.list(id).then((sessions) => [id, sessions] as const))).then((entries) => {
      if (!alive || entries.length === 0) return;
      setProjectSessionsByProject((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      alive = false;
    };
  }, [activeSurface, ctx.projects, ctx.activeProjectId, ctx.treeVersion]);

  // 为所有「已展开」的 Session 拉取各自的节点（树变化时 treeVersion 触发重取）
  useEffect(() => {
    if (!window.api || activeSurface !== "project") return;
    let alive = true;
    const cachedSessions = Object.values(projectSessionsByProject).flat();
    const ids = [...new Set([...ctx.sessions, ...cachedSessions].map((session) => session.id).concat([...sessionExpanded]))];
    Promise.all(
      ids.map((id) => window.api!.canvas.list(id).then((nodes) => [id, nodes] as const)),
    ).then((entries) => {
      if (alive) setOutlines(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [sessionExpanded, projectSessionsByProject, activeSurface, ctx.treeVersion, ctx.sessions]);

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
    const session = [
      ...ctx.sessions,
      ...Object.values(projectSessionsByProject).flat(),
    ].find((item) => item.id === sessionId);
    if (session) {
      if (session.projectId !== ctx.activeProjectId) onSelectProject?.(session.projectId);
      setProjectExpanded((prev) => new Set(prev).add(session.projectId));
      setSessionExpanded((prev) => new Set(prev).add(sessionId));
    }
    ctx.setActiveNodeId(nodeId);
    onFocusNode(sessionId, nodeId);
  }, [ctx.activeProjectId, ctx.sessions, ctx.setActiveNodeId, onFocusNode, onSelectProject, projectSessionsByProject]);

  const renderNodeColor = (sessionId: string, node: CanvasNodeDto) => {
    const colorKey = `${sessionId}:${node.id}`;
    const updateColor = (color: string) => {
      void onSetSessionColor?.(sessionId, node.id, color);
      publishNodeUpdate({ id: node.id, sessionId, color: color || undefined });
      setOutlines((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).map((item) => item.id === node.id ? { ...item, color: color || undefined } : item),
      }));
      setSessionColorOpen(null);
    };
    return (
      <div className="session-color">
        <button
          className={`color-dot ${node.color ? "is-set" : ""}`}
          style={node.color ? { background: `var(--label-${node.color})` } : undefined}
          title="会话颜色"
          aria-label={`${node.title || DEFAULT_ROOT_TITLE} 会话颜色`}
          onClick={(event) => {
            event.stopPropagation();
            setSessionColorOpen((current) => current === colorKey ? null : colorKey);
          }}
        />
        <div className={`color-pop session-color-pop ${sessionColorOpen === colorKey ? "is-open" : ""}`}>
          <button className="color-swatch is-none" title="无色" onClick={() => updateColor("")}>{!node.color && <Check size={11} />}</button>
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
        <button className="sb-label sb-agent-label" onClick={() => toggleExpand(groupId)}>
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
                    <span className={`sb-agent-state ${liveness}`}>{LIVENESS_LABEL[liveness]}</span>
                    <span className="sb-agent-last">{kindLabel(session.events[session.events.length - 1]?.kind ?? "notification")}</span>
                  </span>
                </span>
              </button>
            ))}
            {agents.map((agent: AgentProc) => (
              <div
                className="sb-agent-session muted"
                key={agent.pid}
                title={`${agent.cwd || agentTitle(agent)} · 未接入，重开会话后生效`}
              >
                <span className="state-dot ended" />
                <span className="sb-agent-body">
                  <span className="sb-agent-row">
                    <span className="sb-agent-name">{agentTitle(agent)}</span>
                    <span className="sb-agent-time">{formatDuration(agent.startedAt, ctx.activityNow)}</span>
                  </span>
                  <span className="sb-agent-sub">
                    <span className="sb-agent-state">未接入</span>
                  </span>
                </span>
              </div>
            ))}
            {count === 0 && <div className="sb-agent-empty">暂无会话</div>}
          </div>
        )}
      </Fragment>
    );
  };

  const renderProject = (w: ProjectMeta) => {
    const isProjectExpanded = projectExpanded.has(w.id);
    const cachedSessions = projectSessionsByProject[w.id] ?? [];
    const activeSessionsBelongToProject = ctx.sessions.length > 0 && ctx.sessions.every((session) => session.projectId === w.id);
    const projectSessions = w.id === ctx.activeProjectId
      ? (activeSessionsBelongToProject ? ctx.sessions : cachedSessions)
      : cachedSessions;
    const isProjectSelected = ctx.activeProjectId === w.id && !ctx.activeSessionId && !ctx.activeNodeId;
    return (
      <Fragment key={w.id}>
        <div
          className={`sb-project ${isProjectSelected ? "active" : ""}`}
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
            <Tip label="新建起点">
              <button
                aria-label="新建起点"
                onClick={(e) => {
                  e.stopPropagation();
                  createSessionForProject(w.id);
                }}
              >
                <IconPlus />
              </button>
            </Tip>
            <Tip label={w.pinned ? "取消置顶" : "置顶"}>
              <button
                aria-label={w.pinned ? "取消置顶" : "置顶"}
                onClick={(e) => {
                  e.stopPropagation();
                  onPinProject(w.id, !w.pinned);
                }}
              >
                <Pin size={13} fill={w.pinned ? "currentColor" : "none"} />
              </button>
            </Tip>
            <Tip label="重命名">
              <button
                aria-label="重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(w);
                }}
              >
                <Pencil size={13} />
              </button>
            </Tip>
            <Tip label="删除">
              <button
                aria-label="删除"
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
              <div className="sb-hint">一个会话 = 一张可分支的画布</div>
            )}
            {projectSessions.map((session) => {
              const rows = outlineRows(outlines[session.id] ?? []);
              const rootRow = rows[0];
              const childRows = rows.slice(1);
              const activeNodeId = ctx.activeNodeId;
              if (!rootRow) return null;
              const rootActive = ctx.activeSessionId === session.id && (activeNodeId === rootRow.node.id || !activeNodeId);
              return (
                <Fragment key={session.id}>
                  <SidebarNodeRow
                    root
                    active={rootActive}
                    title={rootRow.node.title || DEFAULT_ROOT_TITLE}
                    colorControl={renderNodeColor(session.id, rootRow.node)}
                    onClick={() => {
                      onSelectSession(session.id);
                      focusNode(session.id, rootRow.node.id);
                    }}
                    actions={(
                      <span className="session-actions">
                        <Tip label="重命名"><button aria-label="重命名会话" onClick={() => setRenamingSession(session)}><Pencil size={13} /></button></Tip>
                        <Tip label="删除"><button aria-label="删除会话" onClick={() => setDeletingSession(session)}><Trash2 size={13} /></button></Tip>
                      </span>
                    )}
                  />
                  <div className={`sb-collapse ${childRows.length > 0 ? "open" : ""}`} aria-hidden={childRows.length === 0}>
                    <div className="sb-collapse-inner sb-outline">
                      {childRows.map(({ node, depth }) => (
                        <SidebarNodeRow
                          key={node.id}
                          active={ctx.activeSessionId === session.id && activeNodeId === node.id}
                          title={depth === 0 ? (node.title || DEFAULT_ROOT_TITLE) : node.title || DEFAULT_BRANCH_TITLE}
                          colorControl={renderNodeColor(session.id, node)}
                          paddingLeft={40 + Math.max(0, depth - 1) * 12}
                          onClick={() => focusNode(session.id, node.id)}
                          actions={(
                            <span className="session-actions">
                              <Tip label="重命名分支"><button aria-label="重命名分支" onClick={() => setRenamingNode(node)}><Pencil size={13} /></button></Tip>
                              <Tip label="删除分支"><button aria-label="删除分支" onClick={() => setDeletingNode(node)}><Trash2 size={13} /></button></Tip>
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

  const pinnedProjects = ctx.projects.filter((project) => project.pinned);
  const regularProjects = ctx.projects.filter((project) => !project.pinned);
  const collapseProjectsButton = (projects: ProjectMeta[], label: string) => {
    const projectIds = new Set(projects.map((project) => project.id));
    return (
      <Tip label={`折叠${label}中的项目`}>
      <button
        className="sb-section-toggle"
        aria-label={`折叠${label}中的项目`}
        onClick={() => {
          setProjectExpanded((current) => new Set([...current].filter((id) => !projectIds.has(id))));
          setSessionColorOpen(null);
        }}
      >
        <PanelTopClose />
      </button>
    </Tip>
    );
  };

  return (
    <div className="sidebar">
      <div className="sb-head">
        <span className="sb-mark">
          <img src={loomIconUrl} alt="Loom" draggable={false} />
        </span>
        <span className="sb-word">
          Loom<small>一起思考</small>
        </span>
        <Tip label="切换明暗">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
        </Tip>
      </div>

      {SURFACES.map((s) => {
        const badge = s.badge?.(ctx);
        return (
          <div
            key={s.id}
            className={`sb-item ${activeSurface === s.id ? "active" : ""}`}
            onClick={() => setSurface(s.id)}
          >
            <s.icon />
            {s.label}
            {badge != null && <span className="badge-num">{badge}</span>}
          </div>
        );
      })}

      {activeSurface === "project" && (
        <div className="sb-tree-scroll" data-testid="project-tree-scroll">
          {pinnedProjects.length > 0 && (
            <>
              <div className="sb-label">
                置顶
                <span className="sb-section-actions">
                  {collapseProjectsButton(pinnedProjects, "置顶")}
                </span>
              </div>
              {pinnedProjects.map(renderProject)}
            </>
          )}
          <div className="sb-label">
            项目
            <span className="sb-section-actions">
              {collapseProjectsButton(regularProjects, "普通项目")}
              <Tip label="新建项目">
                <button className="sb-add" aria-label="新建项目" onClick={() => setCreatingProject(true)}>
                  <IconPlus />
                </button>
              </Tip>
            </span>
          </div>
          {ctx.projects.length === 0 && <div className="sb-hint">（还没有，点 + 新建）</div>}
          {regularProjects.map(renderProject)}
        </div>
      )}

      {activeSurface === "observatory" && (
        <>
          {agentTools.map(renderAgentGroup)}
          {sessionViews.length === 0 && unconnectedAgents.length === 0 && (
            <div className="sb-hint">暂无活动。启用后会显示本地 agent 会话。</div>
          )}
        </>
      )}

      <RenameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="重命名项目"
        initial={renaming?.name ?? ""}
        onSubmit={(name) => renaming && onRenameProject(renaming.id, name)}
      />
      <RenameDialog
        open={!!renamingSession}
        onOpenChange={(o) => !o && setRenamingSession(null)}
        title="重命名会话"
        initial={renamingSession?.title ?? ""}
        onSubmit={(name) => renamingSession && onRenameSession?.(renamingSession.id, name)}
      />
      <RenameDialog
        open={!!renamingNode}
        onOpenChange={(o) => !o && setRenamingNode(null)}
        title="重命名分支"
        initial={renamingNode?.title ?? ""}
        onSubmit={(name) => renamingNode && onRenameNode?.(renamingNode.id, name)}
      />
      <CreateProjectDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onPickFolder={async () => {
          const picker = window.api?.projects?.pickSourceRoot ?? window.api?.acp?.pickDir;
          if (!picker) throw new Error("当前窗口未暴露目录选择器，请重启应用后再试。");
          const result = await picker();
          return result.canceled ? undefined : result.path;
        }}
        onSubmit={onCreateProject}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除项目「${deleting?.name ?? ""}」？`}
        description="此操作不可撤销。"
        onConfirm={() => {
          if (deleting) onDeleteProject(deleting.id);
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingSession}
        onOpenChange={(o) => !o && setDeletingSession(null)}
        title={`删除会话「${deletingSession?.title ?? ""}」？`}
        description="此操作不可撤销。"
        onConfirm={() => {
          if (deletingSession) onDeleteSession?.(deletingSession.id);
          setDeletingSession(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingNode}
        onOpenChange={(o) => !o && setDeletingNode(null)}
        title={`删除分支「${deletingNode?.title ?? ""}」？`}
        description="此操作会删除该分支及其后代。"
        onConfirm={() => {
          if (deletingNode) onDeleteNode?.(deletingNode.id);
          setDeletingNode(null);
        }}
      />
    </div>
  );
}
