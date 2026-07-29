import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  FolderOpen,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
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
  ProjectMeta,
  SettingsPayload,
  SessionMeta,
  SkillCatalogDto,
} from "./env";
import { IconEye, IconPlus, IconSettings, IconProject } from "./icons";
import SessionCanvas from "./canvas/SessionCanvas";
import { useTitlebarActions, useTitlebarContext } from "./titlebar/Titlebar";

export interface SurfaceCtx {
  projects: ProjectMeta[];
  sessions: SessionMeta[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  createProject: (input?: { name?: string; sourceRoots?: string[] }) => void | Promise<void>;
  createSession: () => void;
  goSettings: () => void;
  settings: SettingsPayload | null;
  reloadSettings: () => void;
  theme: "light" | "dark";
  activeNodeId?: string | null;
  setActiveNodeId: (nodeId: string | null) => void;
  sessionMode: "chat" | "canvas";
  setSessionMode: (mode: "chat" | "canvas") => void;
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
function ProjectPanel({ ctx }: { ctx: SurfaceCtx }) {
  const project = ctx.projects.find((p) => p.id === ctx.activeProjectId);
  const session = ctx.sessions.find((s) => s.id === ctx.activeSessionId);
  const noKey = ctx.settings && !ctx.settings.hasKey;
  if (!project) {
    return (
      <div className="surface-empty">
        <div className="big">还没有项目</div>
        <div className="sub">一个项目可以包含多个独立会话。</div>
        <button className="btn" onClick={() => void ctx.createProject()}>
          <IconPlus /> 新建项目
        </button>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="surface-empty">
        <div className="big">还没有会话</div>
        <div className="sub">一个会话 = 一张可分支的研究画布。</div>
        <button className="btn" onClick={ctx.createSession}>
          <IconPlus /> 新建会话
        </button>
      </div>
    );
  }
  return (
    <SessionCanvas
      key={session.id}
      sessionId={session.id}
      sessionName={session.title}
      model={ctx.settings?.resolvedModel}
      noKey={Boolean(noKey)}
      goSettings={ctx.goSettings}
      activeNodeId={ctx.activeNodeId}
      onNodeChange={ctx.setActiveNodeId}
      onModeChange={ctx.setSessionMode}
      onTreeChange={ctx.bumpTreeVersion}
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
export function MonitorPanel({ ctx }: { ctx: SurfaceCtx }) {
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
  const activeTitle = activeSession ? sessionTitle(activeSession) : "工作站";
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
      subtitle: activeCwd || "等待本地 agent 事件",
    }),
    [activeCwd, activeTitle],
  );
  const titlebarActions = useMemo(
    () => (
      <>
        {activeLiveness && (
          <span className={`liveness-pill ${activeLiveness}`}>
            <span className={`state-dot ${activeLiveness}`} />
            {LIVENESS_LABEL[activeLiveness]}
          </span>
        )}
        <button
          className="icon-btn"
          type="button"
          onClick={() => copyPath(activeCwd)}
          aria-label="复制 cwd"
          disabled={!activeCwd}
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
    [activeCwd, activeLiveness, copyPath, openConfig],
  );
  useTitlebarContext(titlebarContext);
  useTitlebarActions(titlebarActions);

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
function defaultApiForProvider(providerId: string) {
  if (providerId.includes("anthropic")) return "anthropic-messages";
  if (providerId.includes("google")) return "google-generative-ai";
  if (providerId.includes("mistral")) return "mistral-conversations";
  return "openai-completions";
}

type RendererProvider = NonNullable<SettingsPayload["modelRegistry"]>["providers"][number];
type RendererModel = RendererProvider["models"][number];

export function SettingsPanel({ ctx }: { ctx: SurfaceCtx }) {
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
  const [saved, setSaved] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogDto | null>(null);
  const [skillSourceDraft, setSkillSourceDraft] = useState("");
  const titlebarContext = useMemo(() => ({ title: "设置" }), []);
  useTitlebarContext(titlebarContext);

  useEffect(() => {
    if (!s) return;
    setSelectedModel(
      s.globalDefaultModel ? `${s.globalDefaultModel.providerId}/${s.globalDefaultModel.modelId}` : "",
    );
    setTheme(s.appearance.theme);
    setMonitorNotify(s.monitor.notify);
  }, [s]);

  const reloadSkills = useCallback(async () => {
    if (!window.api?.settings.skills) return;
    setSkillCatalog(await window.api.settings.skills(ctx.activeProjectId ?? undefined));
  }, [ctx.activeProjectId]);

  useEffect(() => {
    void reloadSkills();
  }, [reloadSkills, s?.skills]);

  if (!s) return <div className="surface-empty">加载中…</div>;

  async function save() {
    const [providerId, modelId] = selectedModel.split("/");
    if (providerId && modelId) await window.api.settings.setGlobalModel({ providerId, modelId });
    await window.api.settings.set({
      appearance: { theme },
      monitor: { notify: monitorNotify },
    });
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
    <div className="surface-fill settings-surface">
      <div className="settings">
      <section className="model-config skills-config">
        <div className="model-config__head">
          <div>
            <h3>Skills</h3>
            <p>管理全局与当前项目可用的 Agent Skills。</p>
          </div>
          <button className="btn" type="button" onClick={reloadSkills}><RefreshCw size={14} /> 重新扫描</button>
        </div>
        <div className="settings-grid">
          <label className="field settings-grid__wide">
            <span>添加全局来源 <em className="src">不会复制或删除原目录</em></span>
            <div className="settings-inline">
              <input value={skillSourceDraft} onChange={(e) => setSkillSourceDraft(e.target.value)} placeholder="/path/to/skills" />
              <button className="btn" type="button" onClick={addSkillSource}>添加</button>
            </div>
          </label>
        </div>
        <div className="connection-list">
          {(skillCatalog?.sources ?? []).map((source) => (
            <div key={source.id} className="connection-row">
              <div className="connection-main">
                <div className="connection-title-row">
                  <div>
                    <div className="connection-name">{source.scope === "project" ? "当前项目" : source.registered ? "全局来源" : "默认全局来源"}</div>
                    <div className="connection-meta">{source.rootPath} · {source.trusted ? "trusted" : "untrusted"}</div>
                  </div>
                  <span className={`status-pill ${source.trusted ? "available" : "unavailable"}`}>{source.scope}</span>
                </div>
              </div>
              <button className="icon-btn" type="button" title="打开目录" onClick={() => window.api.settings.openSkillSource(source.rootPath)}><FolderOpen size={15} /></button>
              {source.registered && <button className="btn" type="button" onClick={() => removeSkillSource(source.rootPath)}>移除</button>}
            </div>
          ))}
          {(skillCatalog?.sources.length ?? 0) === 0 && <div className="empty-state compact"><div className="empty-state__title">暂无 Skill 来源</div></div>}
        </div>
        <div className="connection-list">
          {(skillCatalog?.skills ?? []).map((skill) => (
            <div key={`${skill.sourceId}:${skill.id}:${skill.rootPath}`} className={`connection-row ${skill.active ? "" : "muted"}`}>
              <BookOpen size={16} />
              <div className="connection-main">
                <div className="connection-title-row">
                  <div>
                    <div className="connection-name">{skill.name}</div>
                    <div className="connection-meta">{skill.id} · {skill.scope} · {skill.hash}</div>
                  </div>
                  <span className={`status-pill ${skill.active ? "available" : "unavailable"}`}>{skill.active ? "active" : "overridden"}</span>
                </div>
                <div className="ok-note">{skill.description}</div>
                {skill.diagnostics.map((d) => (
                  <div key={`${d.code}:${d.path ?? ""}`} className={d.level === "error" ? "warn-note" : "ok-note"}>{d.code}: {d.message}</div>
                ))}
              </div>
            </div>
          ))}
          {(skillCatalog?.skills.length ?? 0) === 0 && <div className="empty-state compact"><div className="empty-state__title">没有发现可用 Skills</div><div className="empty-state__body">默认扫描 ~/.loom/skills，当前项目扫描已信任 source root 下的 .loom/skills。</div></div>}
        </div>
      </section>

      <section className="model-config">
        <div className="model-config__head">
          <div>
            <h3>模型配置</h3>
            <p>管理已连接 Provider 的模型，并设置全局默认模型。</p>
          </div>
          <button className="btn primary" type="button" onClick={openAddForm}>添加模型</button>
        </div>

        <div className="model-config__block">
          <div className="model-config__label">已添加模型</div>
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
                          {provider.id} · {provider.source} · {provider.baseUrl || "默认 Base URL"}
                        </div>
                      </div>
                      <span className={`status-pill ${provider.availability}`}>{provider.availability === "available" ? "已连接" : provider.availability}</span>
                    </div>
                    <div className="model-chip-row">
                      {configuredModels.map((model) => (
                        <span key={model.id} className={`model-chip ${model.available ? "" : "empty"}`}>
                          <span>{model.name}</span>
                          <button type="button" onClick={() => editProviderModel(provider, model)}>编辑</button>
                          <button type="button" onClick={() => deleteProviderModel(provider.id, model.id)}>删除</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {configuredProviders.length === 0 && (
              <div className="empty-state">
                <div className="empty-state__title">还没有已添加的模型</div>
                <div className="empty-state__body">点击“添加模型”从 Provider 注册表选择一个 Provider，然后填写模型和凭证。</div>
              </div>
            )}
          </div>
        </div>

        <div className="model-config__block">
          <label className="field">
            <span>默认模型 <em className="src">{availableModels.length} 个已配置模型</em></span>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={availableModels.length === 0}>
              <option value="">{availableModels.length === 0 ? "暂无可用模型" : "自动选择第一个可用模型"}</option>
              {configuredProviders.map((provider) => {
                const configuredModels = provider.models.filter((item) => item.available);
                if (configuredModels.length === 0) return null;
                return (
                  <optgroup key={provider.id} label={provider.name}>
                    {configuredModels.map((item) => (
                      <option key={`${provider.id}/${item.id}`} value={`${provider.id}/${item.id}`}>
                        {item.name} · {item.capabilities.contextWindow.toLocaleString()} ctx · {item.capabilities.maxOutputTokens.toLocaleString()} out
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          {availableModels.length === 0 && <div className="ok-note">配置成功的模型才会出现在默认模型列表里。</div>}
        </div>
        {s.legacyKeyPresent && <div className="warn-note">检测到旧版应用数据库中仍有 API key。Loom 不再使用或迁移它，请把凭证写入 models.json。</div>}
        {hasPlaintextSecret && <div className="warn-note">models.json 包含明文凭证；不要提交或同步到不可信位置。</div>}
      </section>

      {addOpen && (
        <div className="settings-modal" role="dialog" aria-modal="true" aria-label="添加模型配置">
          <div className="settings-modal__panel">
            <div className="settings-modal__head">
              <h3>{editingModel ? "编辑模型" : "添加模型"}</h3>
              <button className="btn" type="button" onClick={() => setAddOpen(false)}>取消</button>
            </div>
            {providerOptions.length === 0 && (
              <div className="empty-state compact">
                <div className="empty-state__title">没有可配置的 Provider。</div>
                <div className="empty-state__body">Provider 注册表为空，暂时无法添加模型。</div>
              </div>
            )}
            <div className="settings-grid">
              <label className="field">
                <span>Provider</span>
                <select value={providerId} onChange={(e) => selectProvider(e.target.value)} disabled={providerOptions.length === 0 || Boolean(editingModel)}>
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} · {provider.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Base URL</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
              </label>
              {useRegistryModel ? (
                <>
                  {editingModel ? (
                    <div className="field model-static">
                      <span>Model</span>
                      <div className="model-static__value">
                        <strong>{selectedModelOption?.name ?? modelId}</strong>
                        <em>{selectedModelOption?.id ?? modelId}</em>
                      </div>
                    </div>
                  ) : (
                    <div className="field settings-grid__wide">
                      <span>
                        Model <em className="src">{selectedModelIds.length}/{providerModelOptions.length} 已选</em>
                      </span>
                      <div className="model-picker" role="group" aria-label="Model">
                        {providerModelOptions.length > 1 && (
                          <div className="model-picker__toolbar">
                            <button type="button" onClick={() => setRegistryModelSelection(providerModelOptions.map((model) => model.id))}>全选</button>
                            <button type="button" onClick={() => setRegistryModelSelection([])}>清空</button>
                          </div>
                        )}
                        <div className="model-picker__list">
                          {providerModelOptions.map((model) => {
                            const checked = selectedModelIds.includes(model.id);
                            return (
                              <label key={model.id} className={`model-option ${checked ? "selected" : ""}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleRegistryModel(model.id)} />
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
                      <span>将添加 {selectedRegistryModels.length} 个模型，共用同一个 Base URL 和 API key。</span>
                    ) : (
                      <span>至少选择一个模型。</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>API type</span>
                    <select value={api} onChange={(e) => setApi(e.target.value)}>
                      <option value="openai-completions">openai-completions</option>
                      <option value="openai-responses">openai-responses</option>
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="google-generative-ai">google-generative-ai</option>
                      <option value="mistral-conversations">mistral-conversations</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-5.2 / claude-sonnet-4-5 / llama" disabled={Boolean(editingModel)} />
                  </label>
                  <label className="field">
                    <span>Model name</span>
                    <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="可选显示名" />
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
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="$OPENAI_API_KEY 或字面 key" />
              </label>
            </div>
            {!useRegistryModel && (
              <div className="settings-checks">
                <label className="check-field">
                  <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
                  <span>支持推理</span>
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />
                  <span>支持图片输入</span>
                </label>
              </div>
            )}
            <div className="settings-foot">
              <button className="btn primary" type="button" onClick={addProviderModel} disabled={!canSaveModel}>保存模型</button>
            </div>
          </div>
        </div>
      )}

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
  { id: "project", label: "项目", icon: IconProject, Panel: ProjectPanel },
  {
    id: "observatory",
    label: "工作站",
    icon: IconEye,
    Panel: MonitorPanel,
    badge: (ctx) => ctx.agentCount || null,
  },
  { id: "settings", label: "设置", icon: IconSettings, Panel: SettingsPanel },
];
