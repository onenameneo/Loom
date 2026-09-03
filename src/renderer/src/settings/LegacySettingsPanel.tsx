import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FolderOpen, Pencil, Plus, Power, Radio, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { SkillCatalogDto } from "../env";
import type { McpSafeServerDto, McpSettingsSnapshot } from "../../../common/mcp";
import type { SurfaceCtx } from "../surfaces";
import { useTitlebarContext } from "../titlebar/Titlebar";
import { ConfirmDialog, Modal } from "../ui/dialogs";
import { LoomCheckboxField, LoomSelect, LoomSelectItem } from "../ui/controls";
import { buttonClassName, iconButtonClassName } from "../ui/styles";
import { useI18n, type TranslationKey } from "../i18n/I18nProvider";
import { emptyMcpForm, formFromMcpServer, mcpFormToConfig, validateMcpForm, type McpFormState } from "./mcpForm";
import { McpKeyValueRows, McpStringRows } from "./McpRepeatableRows";
import { McpTransportToggle } from "./McpTransportToggle";
import { ModelSettingsPanel } from "./ModelSettingsPanel";

export function LegacySettingsPanel({ ctx }: { ctx: SurfaceCtx }) {
  const stdioCommandPlaceholder = window.api?.platform === "win32" ? "npx.cmd" : "npx";
  const { locale, setLocale, t } = useI18n();
  const s = ctx.settings;
  const [selectedModel, setSelectedModel] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [monitorNotify, setMonitorNotify] = useState(true);
  const [profile, setProfile] = useState<"suggest" | "auto-edit" | "full-auto" | "full-access">("auto-edit");
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
    profile: "auto-edit" as const,
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
    setProfile(permissions.profile ?? (permissions.sandboxMode === "read-only" ? "suggest" : permissions.sandboxMode === "danger-full-access" ? "full-access" : "auto-edit"));
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
    await window.api.settings.setPermissions({ profile, approvalsReviewer, networkAccess });
    await window.api.monitor.setNotify(monitorNotify);
    setSaved(true);
    ctx.reloadSettings();
    setTimeout(() => setSaved(false), 1500);
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
                      <label className="field"><span>{t("settings.command")}</span><input value={mcpForm.command} onChange={(event) => setMcpForm((current) => ({ ...current, command: event.target.value }))} placeholder={stdioCommandPlaceholder} /></label>
                      <label className="field"><span>{t("settings.workingDirectory")}</span><input value={mcpForm.cwd} onChange={(event) => setMcpForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/absolute/project/path" /></label>
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <McpStringRows label="参数" values={mcpForm.args} placeholder="-y" onChange={(args) => setMcpForm((current) => ({ ...current, args }))} />
                    </div>
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <McpKeyValueRows label="环境变量" values={mcpForm.env} valuePlaceholder="值" onChange={(env) => setMcpForm((current) => ({ ...current, env }))} />
                      <McpKeyValueRows label="来自环境变量（高级）" values={mcpForm.envRefs} valuePlaceholder="环境变量名" onChange={(envRefs) => setMcpForm((current) => ({ ...current, envRefs }))} />
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
                    <div className="mcp-field-grid">
                      <label className="field"><span>认证方式</span><select value={mcpForm.apiKeyHeader} onChange={(event) => setMcpForm((current) => ({ ...current, apiKeyHeader: event.target.value as "Authorization" | "X-Api-Key", bearerTokenEnv: event.target.value === "X-Api-Key" ? "" : current.bearerTokenEnv }))}><option value="Authorization">Bearer Token</option><option value="X-Api-Key">X-Api-Key</option></select></label>
                      <label className="field"><span>API Key</span><input type="password" value={mcpForm.apiKey} onChange={(event) => setMcpForm((current) => ({ ...current, apiKey: event.target.value, clearApiKey: false }))} placeholder={mcpForm.apiKeyConfigured ? "已配置，留空保持不变" : "粘贴 API Key"} autoComplete="new-password" /></label>
                    </div>
                    {mcpForm.apiKeyConfigured && <button className={buttonClassName(mcpForm.clearApiKey ? "default" : "danger")} type="button" onClick={() => setMcpForm((current) => ({ ...current, clearApiKey: !current.clearApiKey }))}>{mcpForm.clearApiKey ? "取消清除 API Key" : "清除已保存的 API Key"}</button>}
                    <div className="mcp-field-grid mcp-field-grid--single">
                      <label className="field"><span>高级：Bearer 令牌环境变量</span><input value={mcpForm.bearerTokenEnv} onChange={(event) => setMcpForm((current) => ({ ...current, bearerTokenEnv: event.target.value }))} placeholder="MCP_BEARER_TOKEN" /></label>
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

      <ModelSettingsPanel
        ctx={ctx}
        settings={s}
        selectedModel={selectedModel}
        onDefaultModelChange={setSelectedModel}
      />

      <section>
        <h3>{t("settings.agentPermissions")}</h3>
        <p className="settings-help">{t("settings.permissionsHelp")}</p>
        <div className="settings-grid">
          <label className="field">
            <span>{t("settings.permissionMode")}</span>
            <LoomSelect value={profile} onValueChange={(value) => setProfile(value as typeof profile)} placeholder={t("settings.choosePermissionMode")} ariaLabel={t("settings.permissionMode")}>
              <LoomSelectItem value="suggest">{t("settings.profileSuggest")}</LoomSelectItem>
              <LoomSelectItem value="auto-edit">{t("settings.profileAutoEdit")}</LoomSelectItem>
              <LoomSelectItem value="full-auto">{t("settings.profileFullAuto")}</LoomSelectItem>
              <LoomSelectItem value="full-access">{t("settings.profileFullAccess")}</LoomSelectItem>
            </LoomSelect>
          </label>
          <label className="field">
            <span>{t("settings.reviewer")}</span>
            <LoomSelect disabled={profile === "full-access"} value={approvalsReviewer} onValueChange={(value) => setApprovalsReviewer(value as typeof approvalsReviewer)} placeholder={t("settings.chooseReviewer")} ariaLabel={t("settings.reviewer")}>
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
    </div>
  );
}
