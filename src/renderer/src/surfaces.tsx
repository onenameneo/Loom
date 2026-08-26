import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Eye,
  FolderOpen,
  Power,
  PowerOff,
  Radio,
  RotateCcw,
  RefreshCw,
  Settings,
  Pencil,
  Plus,
  Trash2,
  X,
  Wrench,
} from "lucide-react";
import type {
  ActivityEvent,
  ActivitySession,
  ActivityStatus,
  ActivityTool,
  ActivityToolStatus,
  AgentProc,
  ProjectMeta,
  BranchSource,
  SettingsPayload,
  SessionMeta,
} from "./env";
import { IconEye, IconPlus, IconSettings, IconProject } from "./icons";
import SessionCanvas from "./canvas/SessionCanvas";
import { useTitlebarActions, useTitlebarContext } from "./titlebar/Titlebar";
import { ConfirmDialog, Modal } from "./ui/dialogs";
import { buttonClassName, iconButtonClassName } from "./ui/styles";
import { useI18n, type TranslationKey } from "./i18n/I18nProvider";
import { localizedSessionTitle } from "./i18n/titleLabels";
import type { SettingsSectionId } from "./settings/settingsNavigation";
import { SettingsShell } from "./settings/SettingsShell";
import { LegacySettingsPanel } from "./settings/LegacySettingsPanel";

export interface SurfaceCtx {
  projects: ProjectMeta[];
  sessions: SessionMeta[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  openCreateProject: () => void;
  createSession: (projectId?: string) => void;
  goSettings: () => void;
  settings: SettingsPayload | null;
  reloadSettings: () => void;
  theme: "light" | "dark";
  activeNodeId?: string | null;
  setActiveNodeId: (nodeId: string | null) => void;
  sessionMode: "chat" | "canvas" | null;
  setSessionMode: (mode: "chat" | "canvas") => void;
  focusMessageSeq?: number | null;
  treeVersion: number;
  bumpTreeVersion: () => void;
  agentCount: number;
  activitySessions: ActivitySession[];
  agents: AgentProc[];
  activityStatus: ActivityStatus | null;
  activeSessionKey: string | null;
  setActiveSessionKey: (key: string | null) => void;
  activityNow: number;
  refreshActivityStatus: () => Promise<void>;
  runActivityConfig: (action: "enable" | "disable", tool: ActivityTool) => Promise<void>;
  createChatBranch?: (sourceNodeId: string, sourceSeq: number) => void | Promise<void>;
  returnToBranchSource?: (source: BranchSource) => void | Promise<void>;
  settingsSection?: SettingsSectionId;
  setSettingsSection?: (section: SettingsSectionId) => void;
  setSettingsSectionState?: (state: SettingsSectionState | null) => void;
}

export interface SettingsSectionState {
  dirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface Surface {
  id: string;
  label: string;
  translationKey?: TranslationKey;
  icon: (props?: any) => JSX.Element;
  Panel: (p: { ctx: SurfaceCtx }) => JSX.Element;
  badge?: (ctx: SurfaceCtx) => string | number | null;
}

function CreationEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <div className="surface-empty" data-testid="creation-empty-state">
      <div className="big">{title}</div>
      <div className="sub">{description}</div>
      <button className={buttonClassName()} onClick={() => void onAction()}>
        <IconPlus /> {actionLabel}
      </button>
    </div>
  );
}

// ---- 会话主面（对话/画布合一；本阶段单节点聊天）----
function ProjectPanel({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const project = ctx.projects.find((p) => p.id === ctx.activeProjectId);
  const session = ctx.sessions.find((s) => s.id === ctx.activeSessionId);
  const noKey = ctx.settings && !ctx.settings.hasKey;
  if (!project) {
    const hasProjects = ctx.projects.length > 0;
    return (
      <CreationEmptyState
        title={hasProjects ? t("empty.newProjectTitle") : t("empty.noProjectTitle")}
        description={hasProjects ? t("empty.newProjectDescription") : t("empty.noProjectDescription")}
        actionLabel={t("empty.createProject")}
        onAction={ctx.openCreateProject}
      />
    );
  }
  if (!session) {
    const hasSessions = ctx.sessions.length > 0;
    return (
      <CreationEmptyState
        title={hasSessions ? t("empty.newSessionTitle") : t("empty.noSessionTitle")}
        description={hasSessions ? t("empty.newSessionDescription") : t("empty.noSessionDescription")}
        actionLabel={t("empty.createSession")}
        onAction={() => ctx.createSession()}
      />
    );
  }
  return (
    <SessionCanvas
      key={session.id}
      sessionId={session.id}
      sessionName={localizedSessionTitle(session.title, t, session.titleState)}
      model={ctx.settings?.resolvedModel}
      noKey={Boolean(noKey)}
      goSettings={ctx.goSettings}
      activeNodeId={ctx.activeNodeId}
      onNodeChange={ctx.setActiveNodeId}
      onModeChange={ctx.setSessionMode}
      onTreeChange={ctx.bumpTreeVersion}
      initialMode={ctx.sessionMode}
      branchSource={session.branchSource}
      onCreateChatBranch={ctx.createChatBranch}
      onReturnToBranch={ctx.returnToBranchSource}
      focusMessageSeq={ctx.focusMessageSeq ?? undefined}
    />
  );
}

export function isDarwinRenderer(): boolean {
  return window.api?.platform === "darwin";
}

export function formatDuration(startedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function agentTitle(agent: AgentProc): string {
  return agent.project || agent.cwd || `pid ${agent.pid}`;
}

export function formatRelative(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function sessionTitle(session: ActivitySession): string {
  return session.project || session.cwd || session.sessionId;
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function kindLabel(kind: ActivityEvent["kind"], translate?: Translate): string {
  switch (kind) {
    case "tool":
      return translate?.("monitor.kindTool") ?? "工具";
    case "permission":
      return translate?.("monitor.kindPermission") ?? "批准";
    case "turn_end":
      return translate?.("monitor.kindTurn") ?? "回合";
    case "session_start":
      return translate?.("monitor.kindStart") ?? "开始";
    case "stop":
      return translate?.("monitor.kindStop") ?? "结束";
    default:
      return translate?.("monitor.kindNotification") ?? "通知";
  }
}

function eventIcon(kind: ActivityEvent["kind"]) {
  switch (kind) {
    case "tool":
      return Wrench;
    case "permission":
      return BellRing;
    case "turn_end":
    case "stop":
      return CheckCircle2;
    case "session_start":
      return Radio;
    default:
      return Circle;
  }
}

export function applyActivityEvent(list: ActivitySession[], event: ActivityEvent): ActivitySession[] {
  const key = `${event.tool}:${event.sessionId}`;
  const existing = list.find((session) => session.key === key);
  const next: ActivitySession = {
    key,
    tool: event.tool,
    sessionId: event.sessionId,
    cwd: event.cwd || existing?.cwd,
    project: event.project || existing?.project,
    lastActiveAt: event.ts,
    eventCount: (existing?.eventCount ?? 0) + 1,
    events: [...(existing?.events ?? []), event].slice(-200),
  };
  return [next, ...list.filter((session) => session.key !== key)].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export const TOOL_LABEL: Record<ActivityTool, string> = { claude: "Claude Code", codex: "Codex" };
export const TOOL_SHORT_LABEL: Record<ActivityTool, string> = { claude: "Claude", codex: "Codex" };
export const LIVENESS_LABEL: Record<LivenessState, string> = {
  active: "活跃",
  waiting: "待输入",
  idle: "空闲",
  ended: "已结束",
};
export const LIVENESS_ORDER: Record<LivenessState, number> = { active: 0, waiting: 1, idle: 2, ended: 3 };
export function livenessLabel(state: LivenessState, translate?: Translate): string {
  const key: Record<LivenessState, TranslationKey> = {
    active: "monitor.active",
    waiting: "monitor.livenessWaiting",
    idle: "monitor.idle",
    ended: "monitor.ended",
  };
  return translate?.(key[state]) ?? LIVENESS_LABEL[state];
}
// 90s 是本次设计约定的“近期活动”窗口；渲染层每秒 tick 重新派生，便于后续调参。
const ACTIVE_WINDOW_MS = 90_000;

export type LivenessState = "active" | "waiting" | "idle" | "ended";
export type ToolFilter = "all" | ActivityTool;

export interface AgentSessionMatch {
  precision: "weak";
  reason: "cwd" | "project";
  agent: AgentProc;
}

export interface SessionView {
  session: ActivitySession;
  liveness: LivenessState;
  match: AgentSessionMatch | null;
}

export function normalizeActivitySessions(list: ActivitySession[]): ActivitySession[] {
  const bySessionId = new Map<string, ActivitySession>();
  for (const session of list) {
    const key = `${session.tool}:${session.sessionId}`;
    const existing = bySessionId.get(key);
    if (!existing) {
      bySessionId.set(key, { ...session, key });
      continue;
    }
    const events = [...existing.events, ...session.events]
      .sort((a, b) => a.ts - b.ts)
      .slice(-200);
    bySessionId.set(key, {
      key,
      tool: session.tool,
      sessionId: session.sessionId,
      cwd: session.cwd || existing.cwd,
      project: session.project || existing.project,
      lastActiveAt: Math.max(existing.lastActiveAt, session.lastActiveAt),
      eventCount: existing.eventCount + session.eventCount,
      events,
    });
  }
  return [...bySessionId.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

type LinkState = "off" | "pending" | "live";

// 三态的依据刻意分开：configured 只说明 Loom 写过配置，verifiedAt 才说明这条链路
// 真的通了（收到过事件）。Codex 未信任的 hook 会被静默跳过，光看配置永远发现不了。
function linkState(status?: ActivityToolStatus): LinkState {
  if (!status?.configured) return "off";
  return status.verifiedAt ? "live" : "pending";
}

function linkLabel(tool: ActivityTool, status: ActivityToolStatus | undefined, now: number, translate?: Translate): string {
  switch (linkState(status)) {
    case "live":
      return status?.lastEventAt
        ? (translate?.("monitor.connectedAgo", { relative: formatRelative(status.lastEventAt, now) }) ?? `已接入 · ${formatRelative(status.lastEventAt, now)} 前`)
        : (translate?.("monitor.connected") ?? "已接入");
    case "pending":
      return translate?.(tool === "codex" ? "monitor.codexPending" : "monitor.eventPending") ?? (tool === "codex" ? "已写入配置 · 待信任" : "已写入配置 · 待首个事件");
    default:
      return translate?.("monitor.notConnected") ?? "未接入";
  }
}

// 连续的同名工具调用折叠成一条。工具事件在 PostToolUse 下会成为绝大多数，
// 不折叠的话时间线就是一串噪音。
export interface EventGroup {
  key: string;
  events: ActivityEvent[];
}

export function groupEvents(events: ActivityEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    const foldable = event.kind === "tool" && event.toolName;
    const lastEvent = last?.events[last.events.length - 1];
    if (
      foldable &&
      lastEvent &&
      lastEvent.kind === "tool" &&
      lastEvent.toolName === event.toolName
    ) {
      last.events.push(event);
      continue;
    }
    groups.push({ key: event.id, events: [event] });
  }
  return groups;
}

export function matchesAgentSession(agent: AgentProc, session: ActivitySession): AgentSessionMatch | null {
  if (agent.tool !== session.tool) return null;
  if (agent.cwd && session.cwd && agent.cwd === session.cwd) {
    return { precision: "weak", reason: "cwd", agent };
  }
  if (agent.project && session.project && agent.project === session.project) {
    return { precision: "weak", reason: "project", agent };
  }
  return null;
}

export function findAgentSessionMatch(session: ActivitySession, agents: AgentProc[]): AgentSessionMatch | null {
  for (const agent of agents) {
    const match = matchesAgentSession(agent, session);
    if (match) return match;
  }
  return null;
}

export function deriveLiveness(session: ActivitySession, agents: AgentProc[], now: number): LivenessState {
  const match = findAgentSessionMatch(session, agents);
  if (!match) return "ended";
  const last = session.events[session.events.length - 1];
  if (last?.kind === "permission" || last?.kind === "turn_end") return "waiting";
  return now - session.lastActiveAt <= ACTIVE_WINDOW_MS ? "active" : "idle";
}

export function toolMatchesFilter(tool: ActivityTool, filter: ToolFilter): boolean {
  return filter === "all" || tool === filter;
}


export function getSessionViews(
  sessions: ActivitySession[],
  agents: AgentProc[],
  filter: ToolFilter,
  now: number,
): SessionView[] {
  return sessions
    .filter((session) => toolMatchesFilter(session.tool, filter))
    .map<SessionView>((session) => {
      const match = findAgentSessionMatch(session, agents);
      return {
        session,
        match,
        liveness: deriveLiveness(session, agents, now),
      };
    })
    .sort((a, b) => {
      const byState = LIVENESS_ORDER[a.liveness] - LIVENESS_ORDER[b.liveness];
      return byState || b.session.lastActiveAt - a.session.lastActiveAt;
    });
}

// ---- 工作站主面（内部 surface id 仍沿用 observatory）----
export function MonitorPanel({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const [configOpen, setConfigOpen] = useState(false);
  const [busyTool, setBusyTool] = useState<ActivityTool | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const supported = isDarwinRenderer();

  const openConfig = useCallback(() => {
    setConfigOpen(true);
    void ctx.refreshActivityStatus();
  }, [ctx.refreshActivityStatus]);

  async function runConfig(action: "enable" | "disable", tool: ActivityTool) {
    setBusyTool(tool);
    try {
      await ctx.runActivityConfig(action, tool);
    } finally {
      setBusyTool(null);
    }
  }

  const copyPath = useCallback(async (path?: string) => {
    if (!path) return;
    await navigator.clipboard.writeText(path);
  }, []);

  const sessionViews = getSessionViews(ctx.activitySessions, ctx.agents, "all", ctx.activityNow);
  const activeView = sessionViews.find((view) => view.session.key === ctx.activeSessionKey) ?? sessionViews[0] ?? null;
  const activeSession = activeView?.session ?? null;
  const activeTitle = activeSession ? sessionTitle(activeSession) : t("monitor.title");
  const activeCwd = activeSession?.cwd;
  const activeLiveness = activeView?.liveness;
  const telemetry = sessionViews.reduce(
    (acc, view) => {
      acc[view.liveness] += 1;
      return acc;
    },
    { active: 0, waiting: 0, idle: 0, ended: 0 } satisfies Record<LivenessState, number>,
  );

  const titlebarContext = useMemo(
    () => ({
      title: activeTitle,
      subtitle: activeCwd || t("monitor.waiting"),
    }),
    [activeCwd, activeTitle, t],
  );
  const titlebarActions = useMemo(
    () => (
      <>
        {activeLiveness && (
          <span className={`liveness-pill ${activeLiveness}`}>
            <span className={`state-dot ${activeLiveness}`} />
            {livenessLabel(activeLiveness, t)}
          </span>
        )}
        <button
          className={iconButtonClassName()}
          type="button"
          onClick={() => copyPath(activeCwd)}
          aria-label={t("monitor.copyCwd")}
          disabled={!activeCwd}
        >
          <Copy size={15} />
        </button>
        <button
          className={iconButtonClassName("default", "monitor-config-btn")}
          type="button"
          onClick={openConfig}
          aria-label={t("monitor.streamConfig")}
        >
          <Settings size={16} />
        </button>
      </>
    ),
    [activeCwd, activeLiveness, copyPath, openConfig, t],
  );
  useTitlebarContext(titlebarContext);
  useTitlebarActions(titlebarActions);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto w-full max-w-[980px] flex-1 overflow-y-auto px-loom-5 pb-[52px] pt-loom-5">
        <div className="mb-loom-4 flex min-w-0 items-center gap-loom-1" aria-label={t("monitor.telemetry")}>
          {(["active", "waiting", "idle", "ended"] as LivenessState[]).map((state) => (
            <span className={`telemetry-chip ${state}`} key={state}>
              <span className={`state-dot ${state}`} />
              <strong>{telemetry[state]}</strong>
              {livenessLabel(state, t)}
            </span>
          ))}
        </div>

        <section className="activity-layout">
          <div className="activity-timeline">
            {activeSession && activeSession.events.length > 0 ? (
              <div className="activity-events">
                {groupEvents(activeSession.events).map((group) => {
                  const head = group.events[0];
                  const folded = group.events.length > 1;
                  const open = expanded[group.key];
                  const shown = folded && !open ? [] : group.events;
                  const Icon = eventIcon(head.kind);
                  return (
                    <div key={group.key}>
                      {folded && (
                        <article className="activity-event">
                          <span className={`activity-dot ${head.kind}`} />
                          <button
                            className="activity-event-row activity-fold"
                            onClick={() => setExpanded((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                            title={`${head.toolName} × ${group.events.length}`}
                          >
                            <span className="activity-kind"><Icon size={14} /> {kindLabel(head.kind, t)}</span>
                            <strong>{head.toolName} × {group.events.length}</strong>
                            <time><Clock3 size={13} /> {formatRelative(group.events[group.events.length - 1].ts, ctx.activityNow)} {t("monitor.before")}</time>
                          </button>
                        </article>
                      )}
                      {shown.map((event) => (
                        <article className={`activity-event ${folded ? "nested" : ""}`} key={event.id}>
                          <span className={`activity-dot ${event.kind}`} />
                          <div className="activity-event-row" title={event.detail || event.title}>
                            <span className="activity-kind"><Icon size={14} /> {kindLabel(event.kind, t)}</span>
                            <div className="activity-event-main">
                              <strong>{event.title}</strong>
                              {event.detail && <span className="activity-event-detail">{event.detail}</span>}
                            </div>
                            <time><Clock3 size={13} /> {formatRelative(event.ts, ctx.activityNow)} {t("monitor.before")}</time>
                          </div>
                        </article>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="activity-empty large">{t("monitor.empty")}</div>
            )}
          </div>
        </section>
        {!supported && (
          <div className="activity-empty monitor-support-note">{t("monitor.macosNote")}</div>
        )}
      </div>

      <Modal open={configOpen} onOpenChange={setConfigOpen} ariaLabel={t("monitor.streamConfig")}>
        <div className="settings-modal__panel activity-config-panel">
          <div className="settings-modal__head">
            <h3>{t("monitor.configTitle")}</h3>
            <button className={iconButtonClassName()} type="button" onClick={() => setConfigOpen(false)} aria-label={t("monitor.close")} title={t("monitor.close")}>
              <X size={16} />
            </button>
          </div>
          {(["claude", "codex"] as ActivityTool[]).map((tool) => {
            const st = ctx.activityStatus?.tools[tool];
            const state = linkState(st);
            return (
              <section className="activity-tool-card" key={tool}>
                <div className="activity-tool-head">
                  <span className={`activity-status ${state}`} />
                  <strong>{TOOL_LABEL[tool]}</strong>
                  <small>{linkLabel(tool, st, ctx.activityNow, t)}</small>
                </div>
                <code>{st?.path}</code>
                {st?.actionRequired && <p className="activity-note">{st.actionRequired}</p>}
                <div className="activity-tool-actions">
                  {state === "off" ? (
                    <button className={buttonClassName("primary")} disabled={busyTool === tool} onClick={() => runConfig("enable", tool)}>
                      <Power size={15} /> {t("monitor.enable")}
                    </button>
                  ) : (
                    <button className={buttonClassName()} disabled={busyTool === tool} onClick={() => runConfig("disable", tool)}>
                      <PowerOff size={15} /> {t("monitor.disconnect")}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
          <p className="activity-result-note">
            {t("monitor.configNote")}
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ---- 设置主面 ----

export function SettingsPanel({ ctx }: { ctx: SurfaceCtx }) {
  return ctx.settingsSection ? <SettingsShell ctx={ctx} /> : <LegacySettingsPanel ctx={ctx} />;
}

export const SURFACES: Surface[] = [
  { id: "project", label: "项目", translationKey: "nav.project", icon: IconProject, Panel: ProjectPanel },
  {
    id: "observatory",
    label: "工作站",
    translationKey: "nav.observatory",
    icon: IconEye,
    Panel: MonitorPanel,
    badge: (ctx) => ctx.agentCount || null,
  },
  { id: "settings", label: "设置", translationKey: "nav.settings", icon: IconSettings, Panel: SettingsPanel },
];
