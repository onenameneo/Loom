import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Power,
  PowerOff,
  Radio,
  Settings,
  Wrench,
} from "lucide-react";
import type {
  ActivityEvent,
  ActivitySession,
  ActivityStatus,
  ActivityTool,
  ActivityToolStatus,
  AgentProc,
  SettingsPayload,
  WorkspaceMeta,
} from "./env";
import { IconEye, IconPlus, IconSettings, IconWorkspace } from "./icons";
import Workspace from "./canvas/Workspace";
import { useTitlebar } from "./titlebar/Titlebar";

export interface SurfaceCtx {
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string | null;
  createWorkspace: () => void;
  goSettings: () => void;
  settings: SettingsPayload | null;
  reloadSettings: () => void;
  theme: "light" | "dark";
  focusNodeId?: string | null;
  clearFocusNode?: () => void;
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
}

export interface Surface {
  id: string;
  label: string;
  icon: (props?: any) => JSX.Element;
  Panel: (p: { ctx: SurfaceCtx }) => JSX.Element;
  badge?: (ctx: SurfaceCtx) => string | number | null;
}

// ---- 会话主面（对话/画布合一；本阶段单节点聊天）----
function WorkspacePanel({ ctx }: { ctx: SurfaceCtx }) {
  const ws = ctx.workspaces.find((w) => w.id === ctx.activeWorkspaceId);
  const noKey = ctx.settings && !ctx.settings.hasKey;
  if (!ws) {
    return (
      <div className="surface-empty">
        <div className="big">还没有会话</div>
        <div className="sub">一个会话 = 一张可分支的研究画布。</div>
        <button className="btn" onClick={ctx.createWorkspace}>
          <IconPlus /> 新建会话
        </button>
      </div>
    );
  }
  return (
    <Workspace
      key={ws.id}
      workspaceId={ws.id}
      workspaceName={ws.name}
      model={ctx.settings?.resolvedModel}
      noKey={Boolean(noKey)}
      goSettings={ctx.goSettings}
      focusNodeId={ctx.focusNodeId}
      onFocusedNode={ctx.clearFocusNode}
      onTreeChange={ctx.bumpTreeVersion}
    />
  );
}

export function isDarwinRenderer(): boolean {
  return window.api?.platform === "darwin" || (!window.api && /Mac/i.test(navigator.platform));
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

export function kindLabel(kind: ActivityEvent["kind"]): string {
  switch (kind) {
    case "tool":
      return "工具";
    case "permission":
      return "批准";
    case "turn_end":
      return "回合";
    case "session_start":
      return "开始";
    case "stop":
      return "结束";
    default:
      return "通知";
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

function linkLabel(tool: ActivityTool, status: ActivityToolStatus | undefined, now: number): string {
  switch (linkState(status)) {
    case "live":
      return status?.lastEventAt ? `已接入 · ${formatRelative(status.lastEventAt, now)} 前` : "已接入";
    case "pending":
      return tool === "codex" ? "已写入配置 · 待信任" : "已写入配置 · 待首个事件";
    default:
      return "未接入";
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
function MonitorPanel({ ctx }: { ctx: SurfaceCtx }) {
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
  const telemetry = sessionViews.reduce(
    (acc, view) => {
      acc[view.liveness] += 1;
      return acc;
    },
    { active: 0, waiting: 0, idle: 0, ended: 0 } satisfies Record<LivenessState, number>,
  );

  const titlebar = useMemo(
    () => ({
      title: activeSession ? sessionTitle(activeSession) : "工作站",
      subtitle: activeSession?.cwd || "等待本地 agent 事件",
      actions: (
        <>
          {activeView && (
            <span className={`liveness-pill ${activeView.liveness}`}>
              <span className={`state-dot ${activeView.liveness}`} />
              {LIVENESS_LABEL[activeView.liveness]}
            </span>
          )}
          <button
            className="icon-btn"
            type="button"
            onClick={() => copyPath(activeSession?.cwd)}
            aria-label="复制 cwd"
            disabled={!activeSession?.cwd}
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-btn monitor-config-btn"
            type="button"
            onClick={openConfig}
            aria-label="活动流配置"
          >
            <Settings size={16} />
          </button>
        </>
      ),
    }),
    [activeSession, activeView, copyPath, openConfig],
  );
  useTitlebar(titlebar);

  return (
    <div className="surface-fill monitor-surface">
      <div className="monitor">
        <div className="monitor-telemetry" aria-label="活动遥测">
          {(["active", "waiting", "idle", "ended"] as LivenessState[]).map((state) => (
            <span className={`telemetry-chip ${state}`} key={state}>
              <span className={`state-dot ${state}`} />
              <strong>{telemetry[state]}</strong>
              {LIVENESS_LABEL[state]}
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
                            <span className="activity-kind"><Icon size={14} /> {kindLabel(head.kind)}</span>
                            <strong>{head.toolName} × {group.events.length}</strong>
                            <time><Clock3 size={13} /> {formatRelative(group.events[group.events.length - 1].ts, ctx.activityNow)} 前</time>
                          </button>
                        </article>
                      )}
                      {shown.map((event) => (
                        <article className={`activity-event ${folded ? "nested" : ""}`} key={event.id}>
                          <span className={`activity-dot ${event.kind}`} />
                          <div className="activity-event-row" title={event.detail || event.title}>
                            <span className="activity-kind"><Icon size={14} /> {kindLabel(event.kind)}</span>
                            <div className="activity-event-main">
                              <strong>{event.title}</strong>
                              {event.detail && <span className="activity-event-detail">{event.detail}</span>}
                            </div>
                            <time><Clock3 size={13} /> {formatRelative(event.ts, ctx.activityNow)} 前</time>
                          </div>
                        </article>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="activity-empty large">暂无活动。启用活动流后，本地 Claude Code / Codex 的动作会实时出现在这里。</div>
            )}
          </div>
        </section>
        {!supported && (
          <div className="activity-empty monitor-support-note">本地进程发现仅在 macOS 桌面环境可用，活动流事件仍会显示。</div>
          )}
      </div>

      {configOpen && (
        <div className="activity-modal" role="dialog" aria-modal="true" aria-label="活动流配置">
          <div className="activity-modal-backdrop" onClick={() => setConfigOpen(false)} />
          <div className="activity-modal-content">
            <div className="activity-modal-head">
              <h3>活动流接入</h3>
              <button onClick={() => setConfigOpen(false)}>关闭</button>
            </div>
            {(["claude", "codex"] as ActivityTool[]).map((tool) => {
              const st = ctx.activityStatus?.tools[tool];
              const state = linkState(st);
              return (
                <section className="activity-tool-card" key={tool}>
                  <div className="activity-tool-head">
                    <span className={`activity-status ${state}`} />
                    <strong>{TOOL_LABEL[tool]}</strong>
                    <small>{linkLabel(tool, st, ctx.activityNow)}</small>
                  </div>
                  <code>{st?.path}</code>
                  {st?.actionRequired && <p className="activity-note">{st.actionRequired}</p>}
                  <div className="activity-tool-actions">
                    {state === "off" ? (
                      <button className="btn primary" disabled={busyTool === tool} onClick={() => runConfig("enable", tool)}>
                        <Power size={15} /> 启用
                      </button>
                    ) : (
                      <button className="btn" disabled={busyTool === tool} onClick={() => runConfig("disable", tool)}>
                        <PowerOff size={15} /> 断开接入
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
            <p className="activity-result-note">
              只写全局配置，覆盖本机所有 agent。配置改动对正在运行的会话不生效，需重开该会话。
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

// ---- 设置主面 ----
const SRC_ZH: Record<string, string> = {
  settings: "设置",
  env: "环境变量",
  default: "默认",
  none: "未设置",
};

function SettingsPanel({ ctx }: { ctx: SurfaceCtx }) {
  const s = ctx.settings;
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [monitorNotify, setMonitorNotify] = useState(true);
  const [saved, setSaved] = useState(false);
  const titlebar = useMemo(() => ({ title: "设置" }), []);
  useTitlebar(titlebar);

  useEffect(() => {
    if (!s) return;
    setBaseUrl(s.access.baseUrl);
    setModel(s.access.model);
    setTheme(s.appearance.theme);
    setMonitorNotify(s.monitor.notify);
  }, [s]);

  if (!s) return <div className="surface-empty">加载中…</div>;

  async function save() {
    await window.api.settings.set({
      access: { provider: "anthropic", baseUrl, model },
      appearance: { theme },
      monitor: { notify: monitorNotify },
    });
    await window.api.monitor.setNotify(monitorNotify);
    if (keyInput.trim()) {
      await window.api.settings.setKey(keyInput.trim());
      setKeyInput("");
    }
    setSaved(true);
    ctx.reloadSettings();
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="surface-fill">
      <div className="settings">
      <section>
        <h3>接入</h3>
        <label className="field">
          <span>Base URL <em className="src">来源：{SRC_ZH[s.sources.baseUrl]}</em></span>
          <input
            placeholder="留空用官方 / env（如 https://your-proxy/anthropic）"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span>模型 <em className="src">来源：{SRC_ZH[s.sources.model]} · 当前生效 {s.resolvedModel}</em></span>
          <input
            placeholder="留空用 env / 默认（如 claude-sonnet-4-5 / mimo-v2.5）"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label className="field">
          <span>API Key <em className="src">来源：{SRC_ZH[s.sources.key]}{s.hasKey ? " · 已配置" : ""}</em></span>
          <input
            type="password"
            placeholder={s.hasKey ? "已保存（留空则不改）" : "sk-ant-…"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
        </label>
        {!s.encryptionAvailable && (
          <div className="warn-note">系统加密不可用，key 将以明文存储（本机 keychain 缺失）。</div>
        )}
        {s.encryptionAvailable && (
          <div className="ok-note">key 经系统加密后存储，磁盘上无明文。</div>
        )}
      </section>

      <section>
        <h3>外观</h3>
        <label className="field">
          <span>主题</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
            <option value="system">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
        </label>
      </section>

      <section>
        <h3>工作站</h3>
        <label className="check-field">
          <input
            type="checkbox"
            checked={monitorNotify}
            onChange={(e) => setMonitorNotify(e.target.checked)}
          />
          <span>工作站桌面通知（agent 回合完成 / 需要输入时响声提醒）</span>
        </label>
      </section>

      <div className="settings-foot">
        <button className="btn primary" onClick={save}>保存</button>
        {saved && <span className="saved">已保存</span>}
      </div>
      </div>
    </div>
  );
}

export const SURFACES: Surface[] = [
  { id: "workspace", label: "会话", icon: IconWorkspace, Panel: WorkspacePanel },
  {
    id: "observatory",
    label: "工作站",
    icon: IconEye,
    Panel: MonitorPanel,
    badge: (ctx) => ctx.agentCount || null,
  },
  { id: "settings", label: "设置", icon: IconSettings, Panel: SettingsPanel },
];
