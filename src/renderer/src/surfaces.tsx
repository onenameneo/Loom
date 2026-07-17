import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, Circle, Clock3, Power, PowerOff, Radio, Wrench } from "lucide-react";
import type {
  ActivityConfigResult,
  ActivityEvent,
  ActivityScope,
  ActivitySession,
  ActivityStatus,
  ActivityTool,
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
  const next: ActivitySession = existing ?? {
    key,
    tool: event.tool,
    sessionId: event.sessionId,
    cwd: event.cwd,
    project: event.project,
    lastActiveAt: event.ts,
    eventCount: 0,
    events: [],
  };
  next.cwd = event.cwd || next.cwd;
  next.project = event.project || next.project;
  next.lastActiveAt = event.ts;
  next.eventCount += 1;
  next.events = [...next.events, event].slice(-200);
  return [next, ...list.filter((session) => session.key !== key)].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

function matchesAgentSession(agent: AgentProc, session: ActivitySession): boolean {
  if (agent.tool !== session.tool) return false;
  if (agent.cwd && session.cwd) return agent.cwd === session.cwd;
  if (agent.project && session.project) return agent.project === session.project;
  return false;
}

// ---- 工作站主面（内部 surface id 仍沿用 observatory）----
function MonitorPanel(_: { ctx: SurfaceCtx }) {
  const [agents, setAgents] = useState<AgentProc[]>([]);
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [scope, setScope] = useState<ActivityScope>("project");
  const [selectedTools, setSelectedTools] = useState<Record<ActivityTool, boolean>>({ claude: true, codex: true });
  const [configResult, setConfigResult] = useState<ActivityConfigResult | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
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
      setSessions(list);
      setStatus(nextStatus);
      if (!activeKey && list[0]) setActiveKey(list[0].key);
    });
    const off = window.api.activity.onEvent((event) => {
      setSessions((list) => applyActivityEvent(list, event));
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
    setConfigResult(null);
    setConfigOpen(true);
    void refreshStatus();
  }

  function selectedToolList(): ActivityTool[] {
    return (Object.keys(selectedTools) as ActivityTool[]).filter((tool) => selectedTools[tool]);
  }

  async function runConfig(action: "enable" | "disable") {
    const tools = selectedToolList();
    if (!tools.length) return;
    setConfigBusy(true);
    try {
      const result = await window.api.activity[action]({ scope, tools });
      setConfigResult(result);
      setStatus(result.status);
    } finally {
      setConfigBusy(false);
    }
  }

  const activeSession = sessions.find((session) => session.key === activeKey) ?? sessions[0] ?? null;
  const connectedAgents = agents.filter((agent) => sessions.some((session) => matchesAgentSession(agent, session)));
  const selectedFiles = status ? selectedToolList().map((tool) => status.scopes[scope][tool].path) : [];
  const hasPassiveAgents = supported && agents.length > 0;

  return (
    <div className="monitor">
      <div className="monitor-head">
        <h2>工作站</h2>
        <span>{agents.length} 个 agent 在跑 · {sessions.length} 个活动会话</span>
      </div>

      <section className="activity-discovery">
        <div>
          <strong>检测到 {agents.length} 个本地 agent 在跑，{connectedAgents.length} 个已接入活动流</strong>
          <span>{supported ? "Claude Code hooks 与 Codex notify 会被本地 collector 接收。" : "当前版本先支持 macOS 本地进程探测。"}</span>
        </div>
        <button className="btn primary" onClick={openConfig}>
          <Power size={15} /> 启用活动流
        </button>
      </section>

      <section className="activity-layout">
        <div className="activity-sessions">
          <div className="monitor-section-head">
            <h3>会话</h3>
            <span>{sessions.length}</span>
          </div>
          {sessions.length ? (
            sessions.map((session) => (
              <button
                key={session.key}
                className={`activity-session-card ${activeSession?.key === session.key ? "active" : ""}`}
                onClick={() => setActiveKey(session.key)}
              >
                <span className="activity-tool">{session.tool}</span>
                <span className="activity-session-main">
                  <strong>{sessionTitle(session)}</strong>
                  <span>{session.eventCount} 事件 · {formatRelative(session.lastActiveAt, now)} 前</span>
                </span>
              </button>
            ))
          ) : (
            <div className="activity-empty">暂无活动。启用活动流后，本地 Claude Code / Codex 的动作会实时出现在这里。</div>
          )}
        </div>

        <div className="activity-timeline">
          <div className="activity-timeline-head">
            <div>
              <h3>{activeSession ? sessionTitle(activeSession) : "活动流"}</h3>
              <span>{activeSession?.cwd || "等待本地 agent 事件"}</span>
            </div>
            <button className="btn" onClick={openConfig}>
              <PowerOff size={15} /> 配置
            </button>
          </div>
          {activeSession ? (
            <div className="activity-events">
              {activeSession.events.map((event) => {
                const Icon = eventIcon(event.kind);
                return (
                  <article className="activity-event" key={event.id}>
                    <span className={`activity-dot ${event.kind}`} />
                    <div className="activity-event-card">
                      <div className="activity-event-head">
                        <span className="activity-kind"><Icon size={14} /> {kindLabel(event.kind)}</span>
                        <time><Clock3 size={13} /> {formatRelative(event.ts, now)} 前</time>
                      </div>
                      <strong>{event.title}</strong>
                      {event.detail && <p>{event.detail}</p>}
                    </div>
                  </article>
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
            <div className="activity-config-grid">
              <label>
                <span>范围</span>
                <select value={scope} onChange={(event) => setScope(event.target.value as ActivityScope)}>
                  <option value="project">项目级</option>
                  <option value="global">全局</option>
                </select>
              </label>
              <div>
                <span>工具</span>
                <label className="check-field compact">
                  <input
                    type="checkbox"
                    checked={selectedTools.claude}
                    onChange={(event) => setSelectedTools((prev) => ({ ...prev, claude: event.target.checked }))}
                  />
                  <span>Claude Code</span>
                </label>
                <label className="check-field compact">
                  <input
                    type="checkbox"
                    checked={selectedTools.codex}
                    onChange={(event) => setSelectedTools((prev) => ({ ...prev, codex: event.target.checked }))}
                  />
                  <span>Codex</span>
                </label>
              </div>
            </div>
            <div className="activity-files">
              <span>将改动的配置文件</span>
              {selectedFiles.map((file) => (
                <code key={file}>{file}</code>
              ))}
            </div>
            {status?.scopes[scope].codex.conflict && selectedTools.codex && (
              <div className="activity-conflict">{status.scopes[scope].codex.conflict}</div>
            )}
            {configResult?.conflicts.map((conflict) => (
              <div className="activity-conflict" key={`${conflict.tool}:${conflict.path}`}>
                {conflict.message} <code>{conflict.path}</code>
              </div>
            ))}
            <div className="activity-modal-actions">
              <button className="btn" onClick={() => runConfig("disable")} disabled={configBusy}>
                <PowerOff size={15} /> 关闭活动流
              </button>
              <button className="btn primary" onClick={() => runConfig("enable")} disabled={configBusy}>
                <Power size={15} /> 启用活动流
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="monitor-section">
        <div className="monitor-section-head">
          <h3>发现辅助</h3>
          <span>{supported ? `${agents.length} 个进程` : "当前平台暂不支持进程探测"}</span>
        </div>
        {hasPassiveAgents ? (
          <div className="agent-list">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.pid}>
                <div className="agent-tool">{agent.tool}</div>
                <div className="agent-main">
                  <div className="agent-project">{agentTitle(agent)}</div>
                  {agent.cwd && <div className="agent-path">{agent.cwd}</div>}
                </div>
                <div className="agent-meta">
                  <span className={`agent-status ${agent.status}`} aria-label={agent.status} />
                  <span>已运行 {formatDuration(agent.startedAt, now)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="activity-empty">{supported ? "暂无在跑的 agent。" : "当前版本先支持 macOS 本地进程探测。"}</div>
        )}
      </section>
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
          <div className="warn-note">⚠ 系统加密不可用，key 将以明文存储（本机 keychain 缺失）。</div>
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
        {saved && <span className="saved">已保存 ✓</span>}
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
