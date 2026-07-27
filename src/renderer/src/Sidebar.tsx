import { Fragment, useCallback, useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Pencil, Pin, Terminal, Trash2 } from "lucide-react";
import type { ActivityTool, AgentProc, CanvasNodeDto, ProjectMeta, SessionMeta, SettingsPayload } from "./env";
import { IconMoon, IconPlus, IconSun } from "./icons";
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

// 由某会话的节点列表推导「主线→分支」的缩进行（父子关系，深度优先）。
function outlineRows(nodes: CanvasNodeDto[]): Array<{ node: CanvasNodeDto; depth: number }> {
  const byParent = new Map<string | undefined, CanvasNodeDto[]>();
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const rows: Array<{ node: CanvasNodeDto; depth: number }> = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      rows.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
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
  onCreateSession?: () => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  settings?: SettingsPayload | null;
}) {
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [renamingSession, setRenamingSession] = useState<SessionMeta | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionMeta | null>(null);
  // 每个会话独立展开：expanded 记哪些会话展开，outlines 存各自的节点列表。
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["agent:claude", "agent:codex"]));
  const [outlines, setOutlines] = useState<Record<string, CanvasNodeDto[]>>({});

  // 活跃 Session 自动展开（切到它时把它的树打开）
  useEffect(() => {
    if (ctx.activeSessionId) {
      setExpanded((prev) => (prev.has(ctx.activeSessionId!) ? prev : new Set(prev).add(ctx.activeSessionId!)));
    }
  }, [ctx.activeSessionId]);

  // 为所有「已展开」的 Session 拉取各自的节点（树变化时 treeVersion 触发重取）
  useEffect(() => {
    if (!window.api || activeSurface !== "workspace") return;
    let alive = true;
    const sessionIds = new Set(ctx.sessions.map((session) => session.id));
    const ids = [...expanded].filter((id) => sessionIds.has(id));
    Promise.all(
      ids.map((id) => window.api!.canvas.list(id).then((nodes) => [id, nodes] as const)),
    ).then((entries) => {
      if (alive) setOutlines(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [expanded, activeSurface, ctx.treeVersion, ctx.sessions]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  return (
    <div className="sidebar">
      <div className="sb-head">
        <span className="sb-mark" />
        <span className="sb-word">
          Loom<small>思考工作台</small>
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

      {activeSurface === "workspace" && (
        <>
          <div className="sb-label">
            项目
            <Tip label="新建项目">
              <button className="sb-add" aria-label="新建项目" onClick={() => setCreatingProject(true)}>
                <IconPlus />
              </button>
            </Tip>
          </div>
          {ctx.projects.length === 0 && <div className="sb-hint">（还没有，点 + 新建）</div>}
          {ctx.projects.map((w: ProjectMeta) => {
            return (
              <Fragment key={w.id}>
                <div
                  className={`sb-ws ${ctx.activeProjectId === w.id ? "active" : ""}`}
                  onClick={() => onSelectProject?.(w.id)}
                  onDoubleClick={() => setRenaming(w)}
                >
                  <span className="sb-ws-chev" />
                  <span className={`sq ${w.pinned ? "pinned" : ""}`} />
                  <span className="ws-name">
                    {w.name}
                    {w.sourceRoots?.[0] && <small>{w.sourceRoots[0]}</small>}
                  </span>
                  <span className="ws-actions">
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
              </Fragment>
            );
          })}
          {ctx.activeProjectId && (
            <>
              <div className="sb-label">
                会话
                <Tip label="新建会话 (⌘N)">
                  <button className="sb-add" aria-label="新建会话" onClick={onCreateSession}>
                    <IconPlus />
                  </button>
                </Tip>
              </div>
              {ctx.sessions.length === 0 && <div className="sb-hint">（当前项目还没有会话）</div>}
              {ctx.sessions.map((session) => {
                const isExp = expanded.has(session.id);
                const rows = isExp ? outlineRows(outlines[session.id] ?? []) : [];
                const activeNodeId = ctx.sessionMode === "canvas" ? ctx.focusNodeId : ctx.chatNodeId;
                return (
                  <Fragment key={session.id}>
                    <div
                      className={`sb-ws ${ctx.activeSessionId === session.id ? "active" : ""}`}
                      onClick={() => onSelectSession(session.id)}
                      onDoubleClick={() => setRenamingSession(session)}
                    >
                      <button
                        className="sb-ws-chev"
                        title={isExp ? "收起" : "展开分支"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(session.id);
                        }}
                      >
                        {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <span className="sq" />
                      <span className="ws-name">{session.title}</span>
                      <span className="ws-actions">
                        <Tip label="重命名">
                          <button
                            aria-label="重命名"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingSession(session);
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
                              setDeletingSession(session);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Tip>
                      </span>
                    </div>
                    {isExp && rows.length > 0 && (
                      <div className="sb-outline">
                        {rows.map(({ node, depth }) => (
                          <button
                            key={node.id}
                            className={`sb-branch ${ctx.activeSessionId === session.id && (activeNodeId === node.id || (!activeNodeId && depth === 0)) ? "active" : ""}`}
                            style={{ paddingLeft: 30 + depth * 14 }}
                            onClick={() => onFocusNode(session.id, node.id)}
                            title={node.title}
                          >
                            <span className="branch-dot" />
                            <span>{depth === 0 ? "主线" : node.title || "分支"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </>
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
      <CreateProjectDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onPickFolder={async () => {
          const picker = window.api?.projects?.pickSourceFolder ?? window.api?.acp?.pickDir;
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
    </div>
  );
}
