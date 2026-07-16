import { useEffect, useState } from "react";
import type { AgentProc, SettingsPayload, WorkspaceMeta } from "./env";
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

// ---- 工作站主面（内部 surface id 仍沿用 observatory）----
function MonitorPanel(_: { ctx: SurfaceCtx }) {
  const [agents, setAgents] = useState<AgentProc[]>([]);
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

  if (!supported) {
    return (
      <div className="surface-empty">
        <div className="big">工作站暂不支持当前平台</div>
        <div className="sub">当前版本先支持 macOS 本地进程探测。</div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="surface-empty">
        <div className="big">暂无在跑的 agent</div>
        <div className="sub">Codex / Claude Code 会话开始后会自动出现在这里。</div>
      </div>
    );
  }

  return (
    <div className="monitor">
      <div className="monitor-head">
        <h2>工作站</h2>
        <span>{agents.length} 个 agent 在跑</span>
      </div>
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
