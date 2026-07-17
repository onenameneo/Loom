import { useEffect, useState } from "react";
import {
  BellRing,
  Bot,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Power,
  PowerOff,
  Radio,
  Settings,
  Terminal,
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
      isDark={ctx.theme === "dark"}
      noKey={Boolean(noKey)}
      goSettings={ctx.goSettings}
      focusNodeId={ctx.focusNodeId}
      onFocusedNode={ctx.clearFocusNode}
      onTreeChange={ctx.bumpTreeVersion}
    />
  );
}

function isDarwinRenderer(): boolean {
  return /Mac/i.test(navigator.platform);
}

function formatDuration(startedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function agentTitle(agent: AgentProc): string {
  return agent.project || agent.cwd || `pid ${agent.pid}`;
}

function formatRelative(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sessionTitle(session: ActivitySession): string {
  return session.project || session.cwd || session.sessionId;
}

function kindLabel(kind: ActivityEvent["kind"]): string {
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

function applyActivityEvent(list: ActivitySession[], event: ActivityEvent): ActivitySession[] {
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

const TOOL_LABEL: Record<ActivityTool, string> = { claude: "Claude Code", codex: "Codex" };
const TOOL_SHORT_LABEL: Record<ActivityTool, string> = { claude: "Claude", codex: "Codex" };
const LIVENESS_LABEL: Record<LivenessState, string> = {
  active: "活跃",
  waiting: "待输入",
  idle: "空闲",
  ended: "已结束",
};
const LIVENESS_ORDER: Record<LivenessState, number> = { active: 0, waiting: 1, idle: 2, ended: 3 };
// 90s 是本次设计约定的“近期活动”窗口；渲染层每秒 tick 重新派生，便于后续调参。
const ACTIVE_WINDOW_MS = 90_000;

type LivenessState = "active" | "waiting" | "idle" | "ended";
type ToolFilter = "all" | ActivityTool;

interface AgentSessionMatch {
  precision: "weak";
  reason: "cwd" | "project";
  agent: AgentProc;
}

interface SessionView {
  session: ActivitySession;
  liveness: LivenessState;
  match: AgentSessionMatch | null;
}

function normalizeActivitySessions(list: ActivitySession[]): ActivitySession[] {
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
interface EventGroup {
  key: string;
  events: ActivityEvent[];
}

function groupEvents(events: ActivityEvent[]): EventGroup[] {
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

function matchesAgentSession(agent: AgentProc, session: ActivitySession): AgentSessionMatch | null {
  if (agent.tool !== session.tool) return null;
  if (agent.cwd && session.cwd && agent.cwd === session.cwd) {
    return { precision: "weak", reason: "cwd", agent };
  }
  if (agent.project && session.project && agent.project === session.project) {
    return { precision: "weak", reason: "project", agent };
  }
  return null;
}

function findAgentSessionMatch(session: ActivitySession, agents: AgentProc[]): AgentSessionMatch | null {
  for (const agent of agents) {
    const match = matchesAgentSession(agent, session);
    if (match) return match;
  }
  return null;
}

function deriveLiveness(session: ActivitySession, agents: AgentProc[], now: number): LivenessState {
  const match = findAgentSessionMatch(session, agents);
  if (!match) return "ended";
  const last = session.events[session.events.length - 1];
  if (last?.kind === "permission" || last?.kind === "turn_end") return "waiting";
  return now - session.lastActiveAt <= ACTIVE_WINDOW_MS ? "active" : "idle";
}

function toolMatchesFilter(tool: ActivityTool, filter: ToolFilter): boolean {
  return filter === "all" || tool === filter;
}

function eventTitle(event: ActivityEvent): string {
  return event.toolName || event.title;
}

// ---- 工作站主面（内部 surface id 仍沿用 observatory）----
function MonitorPanel(_: { ctx: SurfaceCtx }) {
  const [agents, setAgents] = useState<AgentProc[]>([]);
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all");
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [busyTool, setBusyTool] = useState<ActivityTool | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const supported = isDarwinRenderer();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.api?.monitor) return;
    let cancelled = false;
    window.api.monitor.list().then((list) => {
      if (!cancelled) setAgents(list);
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
      const normalized = normalizeActivitySessions(list);
      setSessions(normalized);
      setStatus(nextStatus);
      if (!activeKey && normalized[0]) setActiveKey(normalized[0].key);
    });
    const off = window.api.activity.onEvent((event) => {
      setSessions((list) => applyActivityEvent(normalizeActivitySessions(list), event));
      setActiveKey((key) => key ?? `${event.tool}:${event.sessionId}`);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeKey]);

  async function refreshStatus() {
    if (window.api?.activity) setStatus(await window.api.activity.status());
  }

  function openConfig() {
    setConfigOpen(true);
    void refreshStatus();
  }

  async function runConfig(action: "enable" | "disable", tool: ActivityTool) {
    setBusyTool(tool);
    try {
      const result = await window.api.activity[action]({ tools: [tool] });
      setStatus(result.status);
    } finally {
      setBusyTool(null);
    }
  }

  async function copyPath(path?: string) {
    if (!path) return;
    await navigator.clipboard.writeText(path);
  }

  const filteredAgents = agents.filter((agent) => toolMatchesFilter(agent.tool, toolFilter));
  const sessionViews = sessions
    .filter((session) => toolMatchesFilter(session.tool, toolFilter))
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
  const activeView = sessionViews.find((view) => view.session.key === activeKey) ?? sessionViews[0] ?? null;
  const activeSession = activeView?.session ?? null;
  const telemetry = sessionViews.reduce(
    (acc, view) => {
      acc[view.liveness] += 1;
      return acc;
    },
    { active: 0, waiting: 0, idle: 0, ended: 0 } satisfies Record<LivenessState, number>,
  );
  // 只保留「一个会话都匹配不上」的在跑进程 —— 有弱匹配的已在上面的会话列表里
  // 以「同目录疑似」呈现，不能再塞进未接入组，否则退化成之前那份冗余列表。
  const unconnectedAgents = supported
    ? filteredAgents
        .filter((agent) => !sessions.some((session) => matchesAgentSession(agent, session)))
        .sort((a, b) => b.startedAt - a.startedAt)
    : [];

  return (
    <div className="monitor">
      <header className="monitor-topbar">
        <div className="monitor-title">
          <h2>工作站</h2>
          <div className="monitor-telemetry" aria-label="活动遥测">
            {(["active", "waiting", "idle", "ended"] as LivenessState[]).map((state) => (
              <span className={`telemetry-chip ${state}`} key={state}>
                <span className={`state-dot ${state}`} />
                <strong>{telemetry[state]}</strong>
                {LIVENESS_LABEL[state]}
              </span>
            ))}
          </div>
        </div>
        <div className="monitor-tools">
          <div className="tool-segment" role="tablist" aria-label="工具过滤">
            {([
              ["all", Radio, "全部"],
              ["claude", Bot, "Claude"],
              ["codex", Terminal, "Codex"],
            ] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                className={toolFilter === value ? "active" : ""}
                onClick={() => setToolFilter(value)}
                role="tab"
                aria-selected={toolFilter === value}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button className="icon-btn monitor-config-btn" onClick={openConfig} aria-label="活动流配置">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="activity-layout">
        <div className="activity-sessions">
          <div className="monitor-section-head">
            <h3>会话</h3>
            <span>{sessionViews.length}</span>
          </div>
          {sessionViews.length ? (
            sessionViews.map(({ session, liveness, match }) => (
              <button
                key={session.key}
                className={`activity-session-card ${activeSession?.key === session.key ? "selected" : ""} ${liveness === "active" ? "live" : ""}`}
                onClick={() => setActiveKey(session.key)}
              >
                <span className={`state-dot ${liveness}`} />
                <span className="activity-session-main">
                  <span className="activity-session-line">
                    <strong>{sessionTitle(session)}</strong>
                    <em>{TOOL_SHORT_LABEL[session.tool]}</em>
                  </span>
                  <span>
                    {kindLabel(session.events[session.events.length - 1]?.kind ?? "notification")} · {formatRelative(session.lastActiveAt, now)} 前
                    {match && <b>同目录疑似</b>}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="activity-empty">暂无活动。启用活动流后，本地 Claude Code / Codex 的动作会实时出现在这里。</div>
          )}
          {unconnectedAgents.length > 0 && (
            <div className="unconnected-group">
              <div className="unconnected-head">
                <span>未接入</span>
                <small>重开会话后生效</small>
              </div>
              {unconnectedAgents.map((agent) => (
                <article className="activity-session-card muted" key={agent.pid}>
                  <span className="state-dot ended" />
                  <span className="activity-session-main">
                    <span className="activity-session-line">
                      <strong>{agentTitle(agent)}</strong>
                      <em>{TOOL_SHORT_LABEL[agent.tool]}</em>
                    </span>
                    <span>已运行 {formatDuration(agent.startedAt, now)}</span>
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="activity-timeline">
          <div className="activity-timeline-head">
            <div className="activity-timeline-title">
              <h3>{activeSession ? sessionTitle(activeSession) : "活动流"}</h3>
              <span>{activeSession?.cwd || "等待本地 agent 事件"}</span>
            </div>
            {activeView && (
              <div className="timeline-actions">
                <span className={`liveness-pill ${activeView.liveness}`}>
                  <span className={`state-dot ${activeView.liveness}`} />
                  {LIVENESS_LABEL[activeView.liveness]}
                </span>
                <button className="icon-btn" onClick={() => copyPath(activeSession?.cwd)} aria-label="复制 cwd" disabled={!activeSession?.cwd}>
                  <Copy size={15} />
                </button>
              </div>
            )}
          </div>
          {activeSession ? (
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
                          <time><Clock3 size={13} /> {formatRelative(group.events[group.events.length - 1].ts, now)} 前</time>
                        </button>
                      </article>
                    )}
                    {shown.map((event) => (
                      <article className={`activity-event ${folded ? "nested" : ""}`} key={event.id}>
                        <span className={`activity-dot ${event.kind}`} />
                        <div className="activity-event-row" title={event.detail || event.title}>
                          <span className="activity-kind"><Icon size={14} /> {kindLabel(event.kind)}</span>
                          <strong>{eventTitle(event)}</strong>
                          <time><Clock3 size={13} /> {formatRelative(event.ts, now)} 前</time>
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

      {configOpen && (
        <div className="activity-modal" role="dialog" aria-modal="true" aria-label="活动流配置">
          <div className="activity-modal-backdrop" onClick={() => setConfigOpen(false)} />
          <div className="activity-modal-content">
            <div className="activity-modal-head">
              <h3>活动流接入</h3>
              <button onClick={() => setConfigOpen(false)}>关闭</button>
            </div>
            {(["claude", "codex"] as ActivityTool[]).map((tool) => {
              const st = status?.tools[tool];
              const state = linkState(st);
              return (
                <section className="activity-tool-card" key={tool}>
                  <div className="activity-tool-head">
                    <span className={`activity-status ${state}`} />
                    <strong>{TOOL_LABEL[tool]}</strong>
                    <small>{linkLabel(tool, st, now)}</small>
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
    <div className="settings">
      <h2>设置</h2>

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
          <span>工作站桌面通知</span>
        </label>
      </section>

      <div className="settings-foot">
        <button className="btn primary" onClick={save}>保存</button>
        {saved && <span className="saved">已保存</span>}
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
