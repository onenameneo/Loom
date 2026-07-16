import { useEffect, useState } from "react";
import { FolderOpen, Send, Shield, Square, X } from "lucide-react";
import type { AcpEvent, AcpPermissionReq, AcpSessionDto, AcpToolCall, AgentProc, SettingsPayload, WorkspaceMeta } from "./env";
import { IconEye, IconPlus, IconSettings, IconWorkspace } from "./icons";
import Workspace from "./canvas/Workspace";
import { Message } from "./message/Message";

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

type AcpChatMessage = { id: string; role: "user" | "assistant"; text: string; streaming?: boolean };
type AcpConversation = { messages: AcpChatMessage[]; tools: AcpToolCall[]; permissions: AcpPermissionReq[] };

function emptyConversation(): AcpConversation {
  return { messages: [], tools: [], permissions: [] };
}

function acpText(update: any): string {
  const content = update?.content;
  return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

function toolStatus(status?: string | null): AcpToolCall["status"] {
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

function mergeMessage(messages: AcpChatMessage[], role: "user" | "assistant", text: string, sourceId?: string | null) {
  if (!text) return messages;
  const id = sourceId || `${role}_${messages.length}`;
  const existingIndex = sourceId ? messages.findIndex((m) => m.id === id && m.role === role) : -1;
  if (existingIndex >= 0) {
    return messages.map((message, index) =>
      index === existingIndex ? { ...message, text: `${message.text}${text}` } : message,
    );
  }
  const last = messages[messages.length - 1];
  if (!sourceId && last?.role === role) {
    return messages.map((message, index) =>
      index === messages.length - 1 ? { ...message, text: `${message.text}${text}` } : message,
    );
  }
  return [...messages, { id, role, text, streaming: role === "assistant" }];
}

function applyAcpUpdate(conversation: AcpConversation, update: any): AcpConversation {
  if (!update?.sessionUpdate) return conversation;
  if (update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_message_chunk") {
    const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
    return {
      ...conversation,
      messages: mergeMessage(conversation.messages, role, acpText(update), update.messageId),
    };
  }
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const id = String(update.toolCallId ?? "");
    if (!id) return conversation;
    const patch: AcpToolCall = {
      id,
      title: update.title || id,
      status: toolStatus(update.status),
      kind: update.kind,
    };
    const exists = conversation.tools.some((tool) => tool.id === id);
    return {
      ...conversation,
      tools: exists
        ? conversation.tools.map((tool) => (tool.id === id ? { ...tool, ...patch, title: patch.title || tool.title } : tool))
        : [...conversation.tools, patch],
    };
  }
  return conversation;
}

function statusLabel(status: AcpSessionDto["status"]): string {
  switch (status) {
    case "starting":
      return "准备中";
    case "thinking":
      return "思考中";
    case "error":
      return "出错";
    case "stopped":
      return "已停止";
    default:
      return "就绪";
  }
}

// ---- 工作站主面（内部 surface id 仍沿用 observatory）----
function MonitorPanel(_: { ctx: SurfaceCtx }) {
  const [agents, setAgents] = useState<AgentProc[]>([]);
  const [sessions, setSessions] = useState<AcpSessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, AcpConversation>>({});
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
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
    if (!window.api?.acp) return;
    let cancelled = false;
    window.api.acp.list().then((list) => {
      if (cancelled) return;
      setSessions(list);
      if (!activeSessionId && list[0]) setActiveSessionId(list[0].id);
    });
    const off = window.api.acp.onEvent((event: AcpEvent) => {
      if (event.type === "started" && event.session) {
        setStarting(false);
        setError(null);
        setSessions((list) => [event.session!, ...list.filter((session) => session.id !== event.session!.id)]);
        setActiveSessionId(event.session.id);
      }
      if (event.type === "stopped" && event.session) {
        setSessions((list) => list.map((session) => (session.id === event.session!.id ? event.session! : session)));
      }
      if (event.type === "error") {
        setStarting(false);
        setError({ message: event.message || "ACP 会话启动失败。", hint: event.hint });
        if (event.sessionId) {
          setSessions((list) =>
            list.map((session) =>
              session.id === event.sessionId ? { ...session, status: "error", error: event.message } : session,
            ),
          );
        }
      }
      if (event.type === "permission" && event.sessionId && event.requestId && event.title && event.options) {
        const req: AcpPermissionReq = {
          sessionId: event.sessionId,
          requestId: event.requestId,
          title: event.title,
          options: event.options,
        };
        setConversations((prev) => {
          const conv = prev[event.sessionId!] ?? emptyConversation();
          return {
            ...prev,
            [event.sessionId!]: {
              ...conv,
              permissions: [...conv.permissions.filter((item) => item.requestId !== req.requestId), req],
            },
          };
        });
      }
      if (event.type === "update" && event.sessionId && event.update) {
        setSessions((list) =>
          list.map((session) =>
            session.id === event.sessionId && session.status !== "stopped"
              ? { ...session, status: event.update?.sessionUpdate === "agent_message_chunk" ? "thinking" : session.status }
              : session,
          ),
        );
        setConversations((prev) => {
          const conv = prev[event.sessionId!] ?? emptyConversation();
          return { ...prev, [event.sessionId!]: applyAcpUpdate(conv, event.update) };
        });
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeSessionId]);

  async function startSession() {
    setError(null);
    const picked = await window.api.acp.pickDir();
    if (picked.canceled || !picked.path) return;
    setStarting(true);
    const result = await window.api.acp.start({ cwd: picked.path });
    if (!result.ok) {
      setStarting(false);
      setError({ message: result.message || "ACP 会话启动失败。", hint: result.hint });
    }
  }

  async function sendPrompt() {
    const text = draft.trim();
    if (!activeSessionId || !text) return;
    setDraft("");
    await window.api.acp.prompt({ sessionId: activeSessionId, text });
  }

  async function respondPermission(req: AcpPermissionReq, optionId?: string) {
    await window.api.acp.respondPermission({ sessionId: req.sessionId, requestId: req.requestId, optionId });
    setConversations((prev) => {
      const conv = prev[req.sessionId] ?? emptyConversation();
      return {
        ...prev,
        [req.sessionId]: { ...conv, permissions: conv.permissions.filter((item) => item.requestId !== req.requestId) },
      };
    });
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeConversation = activeSessionId ? conversations[activeSessionId] ?? emptyConversation() : emptyConversation();
  const hasPassiveAgents = supported && agents.length > 0;

  return (
    <div className="monitor">
      <div className="monitor-head">
        <h2>工作站</h2>
        <span>{agents.length} 个 agent 在跑 · {sessions.length} 个我的会话</span>
      </div>

      <section className="monitor-section acp-section">
        <div className="monitor-section-head">
          <h3>我的会话</h3>
          <button className="btn" onClick={startSession} disabled={starting}>
            <FolderOpen size={15} /> {starting ? "正在准备 adapter…" : "启动会话"}
          </button>
        </div>
        {error && (
          <div className="acp-error">
            <strong>{error.message}</strong>
            {error.hint && <span>{error.hint}</span>}
          </div>
        )}
        {sessions.length === 0 ? (
          <div className="acp-empty">选择一个项目目录，启动由 Loom 管理的 Claude Code 会话。</div>
        ) : (
          <div className="acp-layout">
            <div className="acp-session-list">
              {sessions.map((session) => (
                <button
                  className={`acp-session-card ${session.id === activeSessionId ? "active" : ""}`}
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className={`acp-dot ${session.status}`} />
                  <span className="acp-session-main">
                    <strong>{session.project}</strong>
                    <span>{session.cwd}</span>
                  </span>
                  <span className="acp-session-state">{statusLabel(session.status)}</span>
                </button>
              ))}
            </div>
            <div className="acp-chat">
              {activeSession ? (
                <>
                  <div className="acp-chat-head">
                    <div>
                      <strong>{activeSession.project}</strong>
                      <span>{activeSession.cwd}</span>
                    </div>
                    <div className="acp-chat-actions">
                      <button title="停止生成" onClick={() => window.api.acp.cancel(activeSession.id)}>
                        <Square size={14} />
                      </button>
                      <button title="结束会话" onClick={() => window.api.acp.stop(activeSession.id)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="acp-messages">
                    {activeConversation.messages.map((message) => (
                      <Message
                        key={message.id}
                        role={message.role}
                        text={message.text}
                        density="compact"
                        streaming={message.streaming && activeSession.status === "thinking"}
                      />
                    ))}
                    {activeConversation.tools.map((tool) => (
                      <div className="acp-tool" key={tool.id}>
                        <span className={`acp-dot ${tool.status}`} />
                        <span>{tool.title}</span>
                        {tool.kind && <em>{tool.kind}</em>}
                      </div>
                    ))}
                    {activeConversation.permissions.map((req) => (
                      <div className="acp-permission" key={req.requestId}>
                        <div>
                          <Shield size={15} />
                          <strong>{req.title}</strong>
                        </div>
                        <div className="acp-permission-actions">
                          {req.options.map((option) => (
                            <button key={option.id} onClick={() => respondPermission(req, option.id)}>
                              {option.label}
                            </button>
                          ))}
                          <button onClick={() => respondPermission(req)}>拒绝</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="acp-compose">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="给本地 Claude Code 发送消息"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void sendPrompt();
                      }}
                    />
                    <button className="btn primary" onClick={sendPrompt} disabled={!draft.trim()}>
                      <Send size={15} /> 发送
                    </button>
                  </div>
                </>
              ) : (
                <div className="acp-empty">选择一个会话查看对话。</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="monitor-section">
        <div className="monitor-section-head">
          <h3>在跑的</h3>
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
          <div className="acp-empty">{supported ? "暂无在跑的 agent。" : "当前版本先支持 macOS 本地进程探测。"}</div>
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
