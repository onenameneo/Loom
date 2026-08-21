import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Brain,
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
  Check,
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
  SkillCatalogDto,
} from "./env";
import { IconEye, IconPlus, IconSettings, IconProject } from "./icons";
import SessionCanvas from "./canvas/SessionCanvas";
import { useTitlebarActions, useTitlebarContext } from "./titlebar/Titlebar";
import { ConfirmDialog, Modal } from "./ui/dialogs";
import { LoomCheckbox, LoomCheckboxField, LoomSelect, LoomSelectGroup, LoomSelectItem } from "./ui/controls";
import { buttonClassName, iconButtonClassName } from "./ui/styles";
import MemoryPanel from "./memory/MemoryPanel";
import { useI18n, type TranslationKey } from "./i18n/I18nProvider";
import { localizedSessionTitle } from "./i18n/titleLabels";
import type { McpSafeServerDto, McpSettingsSnapshot } from "../../common/mcp";
import { emptyMcpForm, formFromMcpServer, mcpFormToConfig, validateMcpForm, type McpFormState } from "./settings/mcpForm";
import { McpKeyValueRows, McpStringRows } from "./settings/McpRepeatableRows";
import { McpTransportToggle } from "./settings/McpTransportToggle";

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

function LongTermMemoryPanel({ ctx }: { ctx: SurfaceCtx }) {
  return <MemoryPanel project={ctx.projects.find((project) => project.id === ctx.activeProjectId)} />;
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
function defaultApiForProvider(providerId: string) {
  if (providerId.includes("anthropic")) return "anthropic-messages";
  if (providerId.includes("google")) return "google-generative-ai";
  if (providerId.includes("mistral")) return "mistral-conversations";
  return "openai-completions";
}

type RendererProvider = NonNullable<SettingsPayload["modelRegistry"]>["providers"][number];
type RendererModel = RendererProvider["models"][number];

export function SettingsPanel({ ctx }: { ctx: SurfaceCtx }) {
  const { locale, setLocale, t } = useI18n();
  const s = ctx.settings;
  const [selectedModel, setSelectedModel] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<{ providerId: string; modelId: string } | null>(null);
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [contextWindow, setContextWindow] = useState("131072");
  const [maxTokens, setMaxTokens] = useState("8192");
  const [reasoning, setReasoning] = useState(false);
  const [images, setImages] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [monitorNotify, setMonitorNotify] = useState(true);
  const [sandboxMode, setSandboxMode] = useState<"read-only" | "workspace-write" | "danger-full-access">("workspace-write");
  const [approvalPolicy, setApprovalPolicy] = useState<"untrusted" | "on-request" | "never">("on-request");
  const [approvalsReviewer, setApprovalsReviewer] = useState<"user" | "auto-review">("user");
  const [networkAccess, setNetworkAccess] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [backgroundExtraction, setBackgroundExtraction] = useState(false);
  const [autoDream, setAutoDream] = useState(false);
  const [saved, setSaved] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogDto | null>(null);
  const [skillSourceDraft, setSkillSourceDraft] = useState("");
  const [selectedSkillSource, setSelectedSkillSource] = useState<SkillCatalogDto["sources"][number] | null>(null);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<{ providerId: string; modelId: string; name: string } | null>(null);
  const [mcpSnapshot, setMcpSnapshot] = useState<McpSettingsSnapshot | null>(null);
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState<McpFormState>(() => emptyMcpForm());
  const [editingMcp, setEditingMcp] = useState<McpSafeServerDto | null>(null);
  const [pendingRemoveMcp, setPendingRemoveMcp] = useState<McpSafeServerDto | null>(null);
  const [pendingConsentMcp, setPendingConsentMcp] = useState<McpSafeServerDto | null>(null);
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const titlebarContext = useMemo(() => ({ title: t("nav.settings") }), [t]);
  const permissionDefaults = {
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    networkAccess: false,
    writableRoots: [] as string[],
    commandOutputLimit: 64_000,
  };
  useTitlebarContext(titlebarContext);

  useEffect(() => {
    if (!s) return;
    setSelectedModel(
      s.globalDefaultModel ? `${s.globalDefaultModel.providerId}/${s.globalDefaultModel.modelId}` : "",
    );
    setTheme(s.appearance.theme);
    setMonitorNotify(s.monitor.notify);
    const permissions = { ...permissionDefaults, ...(s.permissions ?? {}) };
    setSandboxMode(permissions.sandboxMode);
    setApprovalPolicy(permissions.approvalPolicy);
    setApprovalsReviewer(permissions.approvalsReviewer);
    setNetworkAccess(permissions.networkAccess);
    setMemoryEnabled(s.memory?.enabled ?? false);
    setBackgroundExtraction(s.memory?.backgroundExtraction ?? false);
    setAutoDream(s.memory?.autoDream ?? false);
  }, [s]);

  const reloadSkills = useCallback(async () => {
    if (!window.api?.settings.skills) return;
    setSkillCatalog(await window.api.settings.skills(ctx.activeProjectId ?? undefined));
  }, [ctx.activeProjectId]);

  useEffect(() => {
    void reloadSkills();
  }, [reloadSkills, s?.skills]);

  const reloadMcp = useCallback(async () => {
    if (!window.api?.mcp) {
      setMcpSnapshot(null);
      return;
    }
    try {
      setMcpSnapshot(await window.api.mcp.list());
      setMcpError(null);
    } catch (cause) {
      setMcpError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void reloadMcp();
    return window.api?.mcp?.onStatus(() => void reloadMcp());
  }, [reloadMcp]);

  if (!s) return <div className="surface-empty">{t("settings.loading")}</div>;

  async function save() {
    const [providerId, modelId] = selectedModel.split("/");
    if (providerId && modelId) await window.api.settings.setGlobalModel({ providerId, modelId });
    await window.api.settings.set({
      appearance: { theme },
      monitor: { notify: monitorNotify },
      memory: {
        enabled: memoryEnabled,
        backgroundExtraction,
        autoDream,
      },
    });
    await window.api.settings.setPermissions({ sandboxMode, approvalPolicy, approvalsReviewer, networkAccess });
    await window.api.monitor.setNotify(monitorNotify);
    setSaved(true);
    ctx.reloadSettings();
    setTimeout(() => setSaved(false), 1500);
  }

  function resetAddForm() {
    setEditingModel(null);
    setProviderId("");
    setBaseUrl("");
    setApiKey("");
    setModelId("");
    setSelectedModelIds([]);
    setModelName("");
    setApi("openai-completions");
    setContextWindow("131072");
    setMaxTokens("8192");
    setReasoning(false);
    setImages(false);
  }

  function applyModelDefaults(model: RendererModel | undefined, fallbackProviderId: string) {
    setModelId(model?.id ?? "");
    setSelectedModelIds(model ? [model.id] : []);
    setModelName(model?.name ?? "");
    setApi(model?.api ?? defaultApiForProvider(fallbackProviderId));
    setContextWindow(String(model?.capabilities.contextWindow ?? 131072));
    setMaxTokens(String(model?.capabilities.maxOutputTokens ?? 8192));
    setReasoning(Boolean(model?.capabilities.reasoning));
    setImages(Boolean(model?.capabilities.images));
  }

  function openAddForm() {
    const firstProvider = providerOptions[0];
    const firstModel = firstProvider?.models[0];
    setEditingModel(null);
    setProviderId(firstProvider?.id ?? "");
    setBaseUrl(firstProvider?.baseUrl ?? "");
    applyModelDefaults(firstModel, firstProvider?.id ?? "");
    setAddOpen(true);
  }

  function editProviderModel(provider: RendererProvider, model: RendererModel) {
    setEditingModel({ providerId: provider.id, modelId: model.id });
    setProviderId(provider.id);
    setBaseUrl(provider.baseUrl ?? "");
    applyModelDefaults(model, provider.id);
    setApiKey("");
    setAddOpen(true);
  }

  function selectProvider(nextProviderId: string) {
    const nextProvider = providerOptions.find((provider) => provider.id === nextProviderId);
    setProviderId(nextProviderId);
    setBaseUrl(nextProvider?.baseUrl ?? "");
    applyModelDefaults(nextProvider?.models[0], nextProviderId);
  }

  function setRegistryModelSelection(nextModelIds: string[]) {
    const selectedProviderConfig = providerOptions.find((provider) => provider.id === providerId);
    const selectedModelConfig = selectedProviderConfig?.models.find((model) => model.id === nextModelIds[0]);
    applyModelDefaults(selectedModelConfig, providerId);
    setSelectedModelIds(nextModelIds);
    setModelId(nextModelIds[0] ?? "");
  }

  function toggleRegistryModel(nextModelId: string) {
    setRegistryModelSelection(
      selectedModelIds.includes(nextModelId)
        ? selectedModelIds.filter((item) => item !== nextModelId)
        : [...selectedModelIds, nextModelId],
    );
  }

  async function addProviderModel() {
    const cleanProviderId = providerId.trim();
    const cleanModelId = modelId.trim();
    const cleanBaseUrl = baseUrl.trim();
    if (!cleanProviderId || !cleanBaseUrl) return;
    const selectedProviderConfig = providerOptions.find((provider) => provider.id === cleanProviderId);
    const providerModels = selectedProviderConfig?.models ?? [];
    if (providerModels.length > 0) {
      const selectedModels = providerModels.filter((model) => selectedModelIds.includes(model.id));
      if (selectedModels.length === 0) return;
      for (const selectedModelConfig of selectedModels) {
        await window.api.settings.addProviderModel({
          providerId: cleanProviderId,
          providerName: selectedProviderConfig?.name,
          baseUrl: cleanBaseUrl,
          apiKey: apiKey.trim() || undefined,
          modelId: selectedModelConfig.id,
          modelName: selectedModelConfig.name,
          api: selectedModelConfig.api,
          contextWindow: selectedModelConfig.capabilities.contextWindow,
          maxTokens: selectedModelConfig.capabilities.maxOutputTokens,
          reasoning: selectedModelConfig.capabilities.reasoning,
          images: selectedModelConfig.capabilities.images,
          modelFromProvider: selectedModelConfig.source === "builtin",
        });
      }
      setAddOpen(false);
      resetAddForm();
      ctx.reloadSettings();
      return;
    }
    if (!cleanModelId) return;
    await window.api.settings.addProviderModel({
      providerId: cleanProviderId,
      providerName: selectedProviderConfig?.name,
      baseUrl: cleanBaseUrl,
      apiKey: apiKey.trim() || undefined,
      modelId: cleanModelId,
      modelName: modelName.trim() || cleanModelId,
      api,
      contextWindow: Number(contextWindow) || 0,
      maxTokens: Number(maxTokens) || 0,
      reasoning,
      images,
      modelFromProvider: false,
    });
    setAddOpen(false);
    resetAddForm();
    ctx.reloadSettings();
  }

  async function deleteProviderModel(providerId: string, modelId: string) {
    await window.api.settings.deleteProviderModel({ providerId, modelId });
    ctx.reloadSettings();
  }

  async function addSkillSource() {
    const path = skillSourceDraft.trim();
    if (!path) return;
    if (!window.api?.settings.addSkillSource) return;
    await window.api.settings.addSkillSource(path);
    setSkillSourceDraft("");
    await ctx.reloadSettings();
    await reloadSkills();
  }

  async function removeSkillSource(path: string) {
    if (!window.api?.settings.removeSkillSource) return;
    await window.api.settings.removeSkillSource(path);
    await ctx.reloadSettings();
    await reloadSkills();
  }

  const mcpServers = mcpSnapshot?.servers ?? [];
  const mcpFormBusy = mcpBusyId === (mcpForm.id || "new");

  function openMcpForm(server?: McpSafeServerDto) {
    setEditingMcp(server ?? null);
    setMcpForm(server ? formFromMcpServer(server) : emptyMcpForm());
    setMcpError(null);
    setMcpFormOpen(true);
  }

  async function saveMcp() {
    const validation = validateMcpForm(mcpForm);
    if (validation) {
      setMcpError(t(`settings.mcpValidation.${validation}` as TranslationKey));
      return;
    }
    const existing = mcpServers.find((server) => server.config.id === mcpFormToConfig(mcpForm).id);
    setMcpBusyId(mcpForm.id || "new");
    try {
      const result = await window.api.mcp.save(mcpFormToConfig(mcpForm, existing ? existing.config.revision + 1 : 1));
      if (!result.ok) {
        setMcpError(result.issues?.map((issue) => `${issue.path}: ${issue.message}`).join(" · ") || t("settings.mcpConnectionFailed"));
        return;
      }
      setMcpFormOpen(false);
      await reloadMcp();
    } catch (cause) {
      setMcpError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMcpBusyId(null);
    }
  }

  async function toggleMcp(server: McpSafeServerDto) {
    setMcpBusyId(server.config.id);
    try {
      await window.api.mcp.setEnabled(server.config.id, !server.config.enabled);
      await reloadMcp();
    } finally {
      setMcpBusyId(null);
    }
  }

  async function connectMcp(server: McpSafeServerDto, reconnect = false) {
    setMcpBusyId(server.config.id);
    setMcpError(null);
    try {
      const result = reconnect
        ? await window.api.mcp.reconnect(server.config.id)
        : await window.api.mcp.test(server.config.id);
      const state = (result.status as { state?: string } | undefined)?.state;
      if (state === "pending-consent") setPendingConsentMcp(server);
      await reloadMcp();
    } catch (cause) {
      setMcpError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMcpBusyId(null);
    }
  }

  async function refreshMcp(server: McpSafeServerDto) {
    setMcpBusyId(server.config.id);
    setMcpError(null);
    try {
      const result = await window.api.mcp.refresh(server.config.id);
      const state = (result.status as { state?: string } | undefined)?.state;
      if (state === "pending-consent") setPendingConsentMcp(server);
      await reloadMcp();
    } catch (cause) {
      setMcpError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMcpBusyId(null);
    }
  }

  async function consentMcp() {
    if (!pendingConsentMcp) return;
    setMcpBusyId(pendingConsentMcp.config.id);
    try {
      await window.api.mcp.consent(pendingConsentMcp.config.id, pendingConsentMcp.config.revision);
      setPendingConsentMcp(null);
      await reloadMcp();
    } catch (cause) {
      setMcpError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMcpBusyId(null);
    }
  }

  async function removeMcp() {
    if (!pendingRemoveMcp) return;
    await window.api.mcp.remove(pendingRemoveMcp.config.id);
    setPendingRemoveMcp(null);
    await reloadMcp();
  }

  const providers = s.modelRegistry?.providers ?? [];
  const providerOptions = providers;
  const configuredProviders = providers
    .map((provider) => ({ ...provider, models: provider.models.filter((model) => model.source !== "builtin") }))
    .filter((provider) => provider.models.length > 0);
  const hasPlaintextSecret = providers.some((provider) => provider.hasPlaintextSecret);
  const availableModels = configuredProviders.flatMap((provider) => provider.models.filter((model) => model.available));
  const selectedProviderOption = providerOptions.find((provider) => provider.id === providerId);
  const providerModelOptions = selectedProviderOption?.models ?? [];
  const selectedModelOption = providerModelOptions.find((model) => model.id === modelId);
  const useRegistryModel = providerModelOptions.length > 0;
  const selectedRegistryModels = providerModelOptions.filter((model) => selectedModelIds.includes(model.id));
  const canSaveModel = providerOptions.length > 0 && Boolean(providerId.trim()) && Boolean(baseUrl.trim()) && (useRegistryModel ? selectedModelIds.length > 0 : Boolean(modelId.trim()));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="settings mx-auto min-h-0 w-full max-w-[760px] overflow-visible px-8 pb-16 pt-8">
      <section className="model-config skills-config">
        <div className="model-config__head">
          <div>
            <h3>{t("settings.skills")}</h3>
            <p>{t("settings.manageSkills")}</p>
          </div>
          <button className={iconButtonClassName()} type="button" onClick={reloadSkills} aria-label={t("settings.scanSkills")} title={t("settings.scanSkills")}><RefreshCw size={16} /></button>
        </div>
        <div className="settings-grid">
          <label className="field settings-grid__wide">
            <span>{t("settings.addSource")} <em className="src">{t("settings.sourceNote")}</em></span>
            <div className="settings-inline">
              <input value={skillSourceDraft} onChange={(e) => setSkillSourceDraft(e.target.value)} placeholder="/path/to/skills" />
              <button className={iconButtonClassName("primary")} type="button" onClick={addSkillSource} aria-label={t("settings.addSkillSource")} title={t("settings.addSkillSource")}><Plus size={16} /></button>
            </div>
          </label>
        </div>
        <div className="connection-list">
          {(skillCatalog?.sources ?? []).map((source) => (
            <div key={source.id} className="connection-row">
              <div className="connection-main">
                <div className="connection-title-row">
                  <div>
                    <div className="source-name-line">
                      <div className="connection-name">{source.scope === "project" ? (source.projectName ?? t("settings.projectSource")) : source.registered ? t("settings.globalSource") : t("settings.defaultGlobalSource")}</div>
                      <span className={`source-tag ${source.scope}`}>{source.scope}</span>
                    </div>
                    <div className="connection-meta">{source.rootPath} · {source.trusted ? "trusted" : "untrusted"}</div>
                  </div>
                </div>
              </div>
              <button className={iconButtonClassName()} type="button" aria-label={t("settings.viewSkills")} title={t("settings.viewSkills")} onClick={() => { setSelectedSkillSource(source); setSkillModalOpen(true); }}><Eye size={15} /></button>
              <button className={iconButtonClassName()} type="button" aria-label={t("settings.openDirectory")} title={t("settings.openDirectory")} onClick={() => window.api.settings.openSkillSource(source.rootPath)}><FolderOpen size={15} /></button>
              {source.registered && <button className={iconButtonClassName("danger")} type="button" onClick={() => removeSkillSource(source.rootPath)} aria-label={`${t("settings.removeSource")} ${source.rootPath}`} title={t("settings.removeSource")}><Trash2 size={15} /></button>}
            </div>
          ))}
          {(skillCatalog?.sources.length ?? 0) === 0 && <div className="empty-state compact"><div className="empty-state__title">{t("settings.noSkillSources")}</div></div>}
        </div>
      </section>

      <section className="model-config" data-testid="mcp-settings">
        <div className="model-config__head">
          <div>
            <h3>{t("settings.mcp")}</h3>
            <p>{t("settings.manageMcp")}</p>
          </div>
          <button className={iconButtonClassName("primary")} type="button" onClick={() => openMcpForm()} aria-label={t("settings.addMcp")} title={t("settings.addMcp")}><Plus size={17} /></button>
        </div>
        {mcpServers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__title">{t("settings.noMcp")}</div>
            <div className="empty-state__body">{t("settings.noMcpBody")}</div>
            <button className={buttonClassName("primary")} type="button" onClick={() => openMcpForm()}><Plus size={15} /> {t("settings.addMcp")}</button>
          </div>
        ) : (
          <div className="connection-list">
            {mcpServers.map((server) => {
              const busy = mcpBusyId === server.config.id;
              const statusClass = server.runtime.state === "connected" ? "available" : server.runtime.state === "failed" ? "unavailable" : "pending";
              return (
                <div key={server.config.id} className="connection-row">
                  <div className="connection-main">
                    <div className="connection-title-row">
                      <div>
                        <div className="connection-name">{server.config.name}</div>
                        <div className="connection-meta">{server.config.transport.type === "stdio" ? "STDIO" : "流式 HTTP"} · {server.config.transport.displayTarget}</div>
                      </div>
                      <span className={`status-pill ${statusClass}`}>{server.runtime.state}</span>
                    </div>
                    <div className="model-chip-row">
                      <span className="model-chip">{t("settings.mcpTools", { count: server.runtime.toolCount })}</span>
                      {server.secrets.map((secret) => <span key={`${secret.source}:${secret.key}`} className={`model-chip ${secret.status === "missing" ? "empty" : ""}`}>{secret.status === "missing" ? t("settings.mcpSecretMissing") : t("settings.mcpSecretConfigured")}</span>)}
                    </div>
                    {server.runtime.tools && server.runtime.tools.length > 0 && <div className="connection-meta mt-loom-2">{server.runtime.tools.map((tool) => `${tool.exposed ? "✓" : "—"} ${tool.title ?? tool.name}`).join(" · ")}</div>}
                    {server.runtime.diagnostics.length > 0 && <div className="warn-note">{server.runtime.diagnostics[server.runtime.diagnostics.length - 1].message}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-loom-1">
                    <button className={iconButtonClassName()} type="button" disabled={busy} onClick={() => void toggleMcp(server)} aria-label={server.config.enabled ? t("settings.mcpEnabled") : t("settings.mcpTest")} title={server.config.enabled ? t("settings.mcpEnabled") : t("settings.mcpTest")}><Power size={14} /></button>
                    <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void connectMcp(server)} aria-label={t("settings.mcpTest")} title={t("settings.mcpTest")}><Radio size={14} /></button>
                    <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void connectMcp(server, true)} aria-label={t("settings.mcpReconnect")} title={t("settings.mcpReconnect")}><RotateCcw size={14} /></button>
                    <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void refreshMcp(server)} aria-label={t("settings.mcpRefresh")} title={t("settings.mcpRefresh")}><RefreshCw size={14} /></button>
                    <button className={iconButtonClassName()} type="button" onClick={() => openMcpForm(server)} aria-label={t("settings.edit")} title={t("settings.edit")}><Pencil size={14} /></button>
                    <button className={iconButtonClassName("danger")} type="button" onClick={() => setPendingRemoveMcp(server)} aria-label={t("settings.mcpRemove")} title={t("settings.mcpRemove")}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {mcpError && <div className="warn-note" role="alert">{mcpError}</div>}
        {mcpSnapshot?.diagnostics.map((diagnostic) => <div key={`${diagnostic.code}:${diagnostic.path}`} className="ok-note">{diagnostic.path}: {diagnostic.message}</div>)}
      </section>

      <Modal open={mcpFormOpen} onOpenChange={(open) => { if (open || !mcpFormBusy) setMcpFormOpen(open); }} ariaLabel={editingMcp ? t("settings.editMcp") : "连接至自定义 MCP"}>
        <div className="settings-modal__panel mcp-settings-modal__panel w-[min(960px,calc(100vw-48px))]">
          <div className="settings-modal__head">
            <div><h3 className="mcp-dialog-title">{editingMcp ? "编辑 MCP" : "连接至自定义 MCP"}</h3></div>
            <button className={iconButtonClassName()} type="button" onClick={() => setMcpFormOpen(false)} disabled={mcpFormBusy} aria-label={t("settings.close")} title={t("settings.close")}><X size={16} /></button>
          </div>
          <form className="mcp-form" onSubmit={(event) => { event.preventDefault(); void saveMcp(); }}>
          <div className="mcp-form-body">
            <section className="mcp-form-card mcp-form-card--identity">
              <label className="field"><span>名称</span><input value={mcpForm.name} onChange={(event) => setMcpForm((current) => ({ ...current, name: event.target.value }))} placeholder="MCP server name" autoFocus /></label>
              <div className="mcp-type-row"><span>类型</span><McpTransportToggle value={mcpForm.transport} onChange={(transport) => setMcpForm((current) => ({ ...current, transport }))} /></div>
            </section>
            <section className="mcp-form-card mcp-form-card--details">
              <div className="mcp-form-layout">
                {mcpForm.transport === "stdio" ? (
                  <>
                    <div className="mcp-field-grid">
                      <label className="field"><span>{t("settings.command")}</span><input value={mcpForm.command} onChange={(event) => setMcpForm((current) => ({ ...current, command: event.target.value }))} placeholder="npx" /></label>
                      <label className="field"><span>{t("settings.workingDirectory")}</span><input value={mcpForm.cwd} onChange={(event) => setMcpForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/absolute/project/path" /></label>
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <McpStringRows label="参数" values={mcpForm.args} placeholder="-y" onChange={(args) => setMcpForm((current) => ({ ...current, args }))} />
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <McpKeyValueRows label="环境变量" values={mcpForm.env} valuePlaceholder="环境变量名" onChange={(env) => setMcpForm((current) => ({ ...current, env }))} />
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <McpStringRows label="环境变量传递" values={mcpForm.inheritEnv} placeholder="PATH" onChange={(inheritEnv) => setMcpForm((current) => ({ ...current, inheritEnv }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <label className="field"><span>{t("settings.endpoint")}</span><input value={mcpForm.url} onChange={(event) => setMcpForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://mcp.example.com/mcp" /></label>
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <label className="field"><span>Bearer 令牌环境变量</span><input value={mcpForm.bearerTokenEnv} onChange={(event) => setMcpForm((current) => ({ ...current, bearerTokenEnv: event.target.value }))} placeholder="MCP_BEARER_TOKEN" /></label>
                    </div>
                    <McpKeyValueRows label="标头" values={mcpForm.headers} valuePlaceholder="值" onChange={(headers) => setMcpForm((current) => ({ ...current, headers }))} />
                    <McpKeyValueRows label="来自环境变量的标头" values={mcpForm.headerEnv} valuePlaceholder="环境变量名" onChange={(headerEnv) => setMcpForm((current) => ({ ...current, headerEnv }))} />
                  </>
                )}
              </div>
            </section>
          </div>
          <div className="mcp-form-error" role="alert" aria-live="polite">{mcpError ?? ""}</div>
          <div className="mcp-form-actions">
            <button className={buttonClassName("primary")} type="submit" disabled={mcpFormBusy}>
              {mcpFormBusy ? t("settings.mcpSaving") : t("settings.mcpSave")}
            </button>
          </div>
          </form>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(pendingRemoveMcp)} onOpenChange={(open) => { if (!open) setPendingRemoveMcp(null); }} title={t("settings.mcpRemove")} description={pendingRemoveMcp ? t("settings.mcpRemoveDescription", { name: pendingRemoveMcp.config.name }) : undefined} onConfirm={() => void removeMcp()} />
      <ConfirmDialog
        open={Boolean(pendingConsentMcp)}
        onOpenChange={(open) => { if (!open) setPendingConsentMcp(null); }}
        title={t("settings.mcpConsentTitle")}
        description={pendingConsentMcp ? (
          <div className="grid gap-loom-2 whitespace-pre-wrap font-loom-mono text-[10.5px] text-loom-muted">
            <p>{t("settings.mcpConsentBody")}</p>
            <div><strong>{t("settings.mcpCommand")}:</strong> {pendingConsentMcp.config.transport.command ?? pendingConsentMcp.config.transport.url}</div>
            {pendingConsentMcp.config.transport.args && <div><strong>{t("settings.mcpArgs")}:</strong> {pendingConsentMcp.config.transport.args.join(" ")}</div>}
            {pendingConsentMcp.config.transport.cwd && <div><strong>{t("settings.mcpCwd")}:</strong> {pendingConsentMcp.config.transport.cwd}</div>}
            {pendingConsentMcp.config.transport.environmentNames && <div><strong>{t("settings.mcpEnv")}:</strong> {pendingConsentMcp.config.transport.environmentNames.join(", ") || "—"}</div>}
            {pendingConsentMcp.config.transport.privilegeWarning && <div className="text-loom-warn"><strong>{pendingConsentMcp.config.transport.privilegeWarning}</strong></div>}
          </div>
        ) : undefined}
        confirmLabel={t("settings.mcpConsent")}
        onConfirm={() => void consentMcp()}
      />

      <section className="model-config">
        <div className="model-config__head">
          <div>
        <h3>{t("settings.modelConfig")}</h3>
            <p>{t("settings.manageModels")}</p>
          </div>
          <button className={iconButtonClassName("primary")} type="button" onClick={openAddForm} aria-label={t("settings.addModel")} title={t("settings.addModel")}><Plus size={17} /></button>
        </div>

        <div className="model-config__block">
          <div className="model-config__label">{t("settings.configuredModels")}</div>
          <div className="connection-list">
            {configuredProviders.map((provider) => {
              const configuredModels = provider.models;
              return (
                <div key={provider.id} className="connection-row">
                  <div className="connection-main">
                    <div className="connection-title-row">
                      <div>
                        <div className="connection-name">{provider.name}</div>
                        <div className="connection-meta">
                            {provider.id} · {provider.source} · {provider.baseUrl || t("settings.defaultBaseUrl")}
                        </div>
                      </div>
                      <span className={`status-pill ${provider.availability}`}>{provider.availability === "available" ? t("settings.connected") : provider.availability}</span>
                    </div>
                    <div className="model-chip-row">
                      {configuredModels.map((model) => (
                        <span key={model.id} className={`model-chip ${model.available ? "" : "empty"}`}>
                          <span>{model.name}</span>
                          <button className={iconButtonClassName()} type="button" onClick={() => editProviderModel(provider, model)} aria-label={t("settings.edit")} title={`${t("settings.edit")} ${model.name}`}><Pencil size={13} /></button>
                          <button className={iconButtonClassName("danger")} type="button" onClick={() => setPendingDeleteModel({ providerId: provider.id, modelId: model.id, name: model.name })} aria-label={t("nav.delete")} title={`${t("nav.delete")} ${model.name}`}><Trash2 size={13} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {configuredProviders.length === 0 && (
              <div className="empty-state">
                <div className="empty-state__title">{t("settings.noModels")}</div>
                <div className="empty-state__body">{t("settings.noModelsBody")}</div>
              </div>
            )}
          </div>
        </div>

        <div className="model-config__block">
          <label className="field">
            <span>{t("settings.defaultModel")} <em className="src">{availableModels.length} {t("settings.configuredModels")}</em></span>
            <LoomSelect value={selectedModel || "__auto__"} onValueChange={(value) => setSelectedModel(value === "__auto__" ? "" : value)} disabled={availableModels.length === 0} placeholder={availableModels.length === 0 ? t("settings.noAvailableModels") : t("settings.autoFirstModel")} ariaLabel={t("settings.defaultModel")}>
              <LoomSelectItem value="__auto__">{availableModels.length === 0 ? t("settings.noAvailableModels") : t("settings.autoFirstModel")}</LoomSelectItem>
              {configuredProviders.map((provider) => {
                const configuredModels = provider.models.filter((item) => item.available);
                if (configuredModels.length === 0) return null;
                return (
                  <LoomSelectGroup key={provider.id} label={provider.name}>
                    {configuredModels.map((item) => (
                      <LoomSelectItem key={`${provider.id}/${item.id}`} value={`${provider.id}/${item.id}`}>
                        {item.name} · {item.capabilities.contextWindow.toLocaleString()} ctx · {item.capabilities.maxOutputTokens.toLocaleString()} out
                      </LoomSelectItem>
                    ))}
                  </LoomSelectGroup>
                );
              })}
            </LoomSelect>
          </label>
          {availableModels.length === 0 && <div className="ok-note">{t("settings.successfulModelsOnly")}</div>}
        </div>
        {s.legacyKeyPresent && <div className="warn-note">{t("settings.legacyKey")}</div>}
        {hasPlaintextSecret && <div className="warn-note">{t("settings.plaintextSecret")}</div>}
      </section>

      <Modal open={addOpen} onOpenChange={setAddOpen} ariaLabel={t("settings.modelDialogAria")}>
          <div className="settings-modal__panel">
            <div className="settings-modal__head">
              <h3>{editingModel ? t("settings.editModel") : t("settings.addModel")}</h3>
              <button className={iconButtonClassName()} type="button" onClick={() => setAddOpen(false)} aria-label={t("settings.close")} title={t("settings.close")}><X size={16} /></button>
            </div>
            {providerOptions.length === 0 && (
              <div className="empty-state compact">
                <div className="empty-state__title">{t("settings.noProvider")}</div>
                <div className="empty-state__body">{t("settings.emptyRegistry")}</div>
              </div>
            )}
            <div className="settings-grid">
              <label className="field">
                <span>Provider</span>
                <LoomSelect value={providerId} onValueChange={selectProvider} disabled={providerOptions.length === 0 || Boolean(editingModel)} placeholder={t("settings.chooseProvider")} ariaLabel="Provider">
                  {providerOptions.map((provider) => (
                    <LoomSelectItem key={provider.id} value={provider.id}>
                      {provider.name} · {provider.id}
                    </LoomSelectItem>
                  ))}
                </LoomSelect>
              </label>
              <label className="field">
                <span>Base URL</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
              </label>
              {useRegistryModel ? (
                <>
                  {editingModel ? (
                    <div className="field model-static">
                <span>{t("settings.modelConfig")}</span>
                      <div className="model-static__value">
                        <strong>{selectedModelOption?.name ?? modelId}</strong>
                        <em>{selectedModelOption?.id ?? modelId}</em>
                      </div>
                    </div>
                  ) : (
                    <div className="field settings-grid__wide">
                      <span>
                        Model <em className="src">{selectedModelIds.length}/{providerModelOptions.length} {t("settings.selectedCount")}</em>
                      </span>
                      <div className="model-picker" role="group" aria-label="Model">
                        {providerModelOptions.length > 1 && (
                          <div className="model-picker__toolbar">
                            <button type="button" onClick={() => setRegistryModelSelection(providerModelOptions.map((model) => model.id))}>{t("settings.selectAll")}</button>
                            <button type="button" onClick={() => setRegistryModelSelection([])}>{t("settings.clear")}</button>
                          </div>
                        )}
                        <div className="model-picker__list">
                          {providerModelOptions.map((model) => {
                            const checked = selectedModelIds.includes(model.id);
                            return (
                              <label key={model.id} className={`model-option ${checked ? "selected" : ""}`}>
                                <LoomCheckbox
                                  id={`model-option-${model.id}`}
                                  checked={checked}
                                  onCheckedChange={() => toggleRegistryModel(model.id)}
                                  ariaLabel={model.name}
                                />
                                <span className="model-option__main">
                                  <strong>{model.name}</strong>
                                  <em>{model.id}</em>
                                </span>
                                <span className="model-option__tags">
                                  <span>{model.api}</span>
                                  <span>{model.capabilities.contextWindow.toLocaleString()} ctx</span>
                                  <span>{model.capabilities.maxOutputTokens.toLocaleString()} out</span>
                                  {model.capabilities.reasoning && <span>reasoning</span>}
                                  {model.capabilities.images && <span>image</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="model-summary settings-grid__wide">
                    {selectedRegistryModels.length === 1 ? (
                      <>
                        <span>{selectedRegistryModels[0].api}</span>
                        <span>{selectedRegistryModels[0].capabilities.contextWindow.toLocaleString()} ctx</span>
                        <span>{selectedRegistryModels[0].capabilities.maxOutputTokens.toLocaleString()} out</span>
                        {selectedRegistryModels[0].capabilities.reasoning && <span>reasoning</span>}
                        {selectedRegistryModels[0].capabilities.images && <span>image</span>}
                      </>
                    ) : selectedRegistryModels.length > 1 ? (
                      <span>{t("settings.modelsWillShare", { count: selectedRegistryModels.length })}</span>
                    ) : (
                      <span>{t("settings.selectAtLeastOne")}</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>API type</span>
                    <LoomSelect value={api} onValueChange={setApi} placeholder={t("settings.chooseApiType")} ariaLabel="API type">
                      <LoomSelectItem value="openai-completions">openai-completions</LoomSelectItem>
                      <LoomSelectItem value="openai-responses">openai-responses</LoomSelectItem>
                      <LoomSelectItem value="anthropic-messages">anthropic-messages</LoomSelectItem>
                      <LoomSelectItem value="google-generative-ai">google-generative-ai</LoomSelectItem>
                      <LoomSelectItem value="mistral-conversations">mistral-conversations</LoomSelectItem>
                    </LoomSelect>
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-5.2 / claude-sonnet-4-5 / llama" disabled={Boolean(editingModel)} />
                  </label>
                  <label className="field">
                    <span>Model name</span>
                    <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={t("settings.optionalDisplayName")} />
                  </label>
                  <label className="field">
                    <span>Context window</span>
                    <input inputMode="numeric" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Max output</span>
                    <input inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
                  </label>
                </>
              )}
              <label className="field settings-grid__wide">
                <span>API key</span>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t("settings.apiKeyPlaceholder")} />
              </label>
            </div>
            {!useRegistryModel && (
              <div className="settings-checks">
                <LoomCheckboxField checked={reasoning} onCheckedChange={setReasoning} label={t("settings.supportsReasoning")} />
                <LoomCheckboxField checked={images} onCheckedChange={setImages} label={t("settings.supportsImages")} />
              </div>
            )}
            <div className="settings-foot">
              <button className={iconButtonClassName("primary")} type="button" onClick={addProviderModel} disabled={!canSaveModel} aria-label={t("settings.saveModel")} title={t("settings.saveModel")}><Check size={16} /></button>
            </div>
          </div>
        </Modal>

      <section>
        <h3>{t("settings.agentPermissions")}</h3>
        <p className="settings-help">{t("settings.permissionsHelp")}</p>
        <div className="settings-grid">
          <label className="field">
            <span>{t("settings.sandbox")}</span>
            <LoomSelect value={sandboxMode} onValueChange={(value) => setSandboxMode(value as typeof sandboxMode)} placeholder={t("settings.chooseSandbox")} ariaLabel={t("settings.sandbox")}>
              <LoomSelectItem value="read-only">{t("settings.readOnly")}</LoomSelectItem>
              <LoomSelectItem value="workspace-write">{t("settings.workspaceWrite")}</LoomSelectItem>
              <LoomSelectItem value="danger-full-access">{t("settings.fullAccess")}</LoomSelectItem>
            </LoomSelect>
          </label>
          <label className="field">
            <span>Approval policy</span>
            <LoomSelect value={approvalPolicy} onValueChange={(value) => setApprovalPolicy(value as typeof approvalPolicy)} placeholder={t("settings.chooseApprovalPolicy")} ariaLabel={t("settings.approvalPolicy")}>
              <LoomSelectItem value="on-request">{t("settings.askOutOfBounds")}</LoomSelectItem>
              <LoomSelectItem value="untrusted">{t("settings.askUntrusted")}</LoomSelectItem>
              <LoomSelectItem value="never">{t("settings.neverAsk")}</LoomSelectItem>
            </LoomSelect>
          </label>
          <label className="field">
            <span>{t("settings.reviewer")}</span>
            <LoomSelect value={approvalsReviewer} onValueChange={(value) => setApprovalsReviewer(value as typeof approvalsReviewer)} placeholder={t("settings.chooseReviewer")} ariaLabel={t("settings.reviewer")}>
              <LoomSelectItem value="user">{t("settings.me")}</LoomSelectItem>
              <LoomSelectItem value="auto-review">{t("settings.autoReview")}</LoomSelectItem>
            </LoomSelect>
          </label>
        </div>
        <LoomCheckboxField checked={networkAccess} onCheckedChange={setNetworkAccess} label={t("settings.network")} />
        <div className="ok-note">{t("settings.recommended")}</div>
      </section>

      <section>
        <h3>{t("settings.appearance")}</h3>
        <label className="field">
          <span>{t("settings.language")}</span>
          <LoomSelect value={locale} onValueChange={(value) => setLocale(value as typeof locale)} placeholder={t("settings.language")} ariaLabel={t("settings.language")}>
            <LoomSelectItem value="zh-CN">{t("settings.languageChinese")}</LoomSelectItem>
            <LoomSelectItem value="en">{t("settings.languageEnglish")}</LoomSelectItem>
          </LoomSelect>
          <em className="src">{t("settings.languageHelp")}</em>
        </label>
        <label className="field">
          <span>{t("settings.theme")}</span>
          <LoomSelect value={theme} onValueChange={(value) => setTheme(value as typeof theme)} placeholder={t("settings.theme")} ariaLabel={t("settings.theme")}>
            <LoomSelectItem value="system">{t("settings.system")}</LoomSelectItem>
            <LoomSelectItem value="light">{t("settings.light")}</LoomSelectItem>
            <LoomSelectItem value="dark">{t("settings.dark")}</LoomSelectItem>
          </LoomSelect>
        </label>
      </section>

      <section>
        <h3>{t("settings.workstation")}</h3>
        <LoomCheckboxField
          checked={monitorNotify}
          onCheckedChange={setMonitorNotify}
          label={t("settings.monitorNotification")}
        />
      </section>

      <section className="settings-memory-section">
        <h3>{t("settings.memory")}</h3>
        <p className="settings-help">{t("settings.memoryHelp")}</p>
        <div className="settings-memory-options">
          <LoomCheckboxField checked={memoryEnabled} onCheckedChange={setMemoryEnabled} label={t("settings.enableMemory")} />
          <LoomCheckboxField
            checked={backgroundExtraction}
            onCheckedChange={setBackgroundExtraction}
            disabled={!memoryEnabled}
            label={t("settings.extractCandidates")}
            description={<em className="src">{t("settings.memoryDefaultOff")}</em>}
          />
          <LoomCheckboxField checked={autoDream} onCheckedChange={setAutoDream} disabled={!memoryEnabled} label={t("settings.allowAutoDream")} />
        </div>
      </section>

      <div className="settings-foot settings-actions">
        <button className={buttonClassName("primary")} onClick={save}>{t("settings.save")}</button>
        {saved && <span className="saved">{t("settings.saved")}</span>}
      </div>
      </div>
      <Modal open={skillModalOpen} onOpenChange={setSkillModalOpen} ariaLabel={`${selectedSkillSource?.scope === "project" ? t("settings.projectSource") : t("settings.globalSource")} Skills`}>
          <div className="settings-modal__panel" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal__head">
              <div>
                <h3>{selectedSkillSource?.scope === "project" ? (selectedSkillSource.projectName ?? t("settings.projectSource")) : t("settings.globalSource")} · Skills</h3>
                <div className="connection-meta">{selectedSkillSource?.rootPath ?? ""} · {selectedSkillSource?.trusted ? "trusted" : "untrusted"}</div>
              </div>
              <button className={iconButtonClassName()} type="button" onClick={() => setSkillModalOpen(false)} aria-label={t("settings.closeSkills")} title={t("settings.closeSkills")}><X size={16} /></button>
            </div>
            <div className="skills-list skill-detail__list">
              {(skillCatalog?.skills ?? []).filter((skill) => selectedSkillSource && (skill.sourceId === selectedSkillSource.id || skill.rootPath === selectedSkillSource.rootPath)).map((skill) => (
                <div key={`${skill.sourceId}:${skill.id}:${skill.rootPath}`} className={`skill-detail__row ${skill.active ? "" : "muted"}`}>
                  <div className="connection-title-row">
                    <div>
                      <div className="connection-name">{skill.name}</div>
                      <div className="connection-meta">{skill.id} · {skill.hash}</div>
                    </div>
                    <span className={`status-pill ${skill.active ? "available" : "unavailable"}`}>{skill.active ? t("settings.active") : t("settings.overridden")}</span>
                  </div>
                  <div className="ok-note skill-summary">{skill.description || t("settings.noDescription")}</div>
                  {skill.diagnostics.map((d) => <div key={`${d.code}:${d.path ?? ""}`} className={d.level === "error" ? "warn-note" : "ok-note"}>{d.code}: {d.message}</div>)}
                </div>
              ))}
              {(skillCatalog?.skills ?? []).filter((skill) => selectedSkillSource && (skill.sourceId === selectedSkillSource.id || skill.rootPath === selectedSkillSource.rootPath)).length === 0 && <div className="empty-state compact"><div className="empty-state__title">{t("settings.noSkillsFound")}</div></div>}
            </div>
          </div>
        </Modal>
      <ConfirmDialog
        open={Boolean(pendingDeleteModel)}
        onOpenChange={(open) => { if (!open) setPendingDeleteModel(null); }}
        title={t("settings.deleteModel")}
        description={pendingDeleteModel ? t("settings.deleteModelDescription", { name: pendingDeleteModel.name }) : undefined}
        onConfirm={() => {
          if (!pendingDeleteModel) return;
          void deleteProviderModel(pendingDeleteModel.providerId, pendingDeleteModel.modelId);
          setPendingDeleteModel(null);
        }}
      />
    </div>
  );
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
  { id: "memory", label: "记忆", translationKey: "nav.memory", icon: (props) => <Brain {...props} />, Panel: LongTermMemoryPanel },
  { id: "settings", label: "设置", translationKey: "nav.settings", icon: IconSettings, Panel: SettingsPanel },
];
