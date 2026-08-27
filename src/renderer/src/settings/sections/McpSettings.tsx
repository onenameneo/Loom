import { Pencil, Plus, Power, Radio, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { SurfaceCtx } from "../../surfaces";
import type { McpSafeServerDto } from "../../../../common/mcp";
import { useI18n } from "../../i18n/I18nProvider";
import { ConfirmDialog, Modal } from "../../ui/dialogs";
import { buttonClassName, iconButtonClassName } from "../../ui/styles";
import { McpKeyValueRows, McpStringRows } from "../McpRepeatableRows";
import { McpBearerCredentialField } from "../McpBearerCredentialField";
import { McpTransportToggle } from "../McpTransportToggle";
import { SettingsToolbar } from "../components/SettingsSection";
import { useMcpSettings } from "../hooks/useMcpSettings";

export function McpSettings(_props: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const state = useMcpSettings();
  const servers: McpSafeServerDto[] = state.snapshot?.servers ?? [];
  const formBusy = state.busyId === (state.form.id || "new");

  return (
    <>
      <SettingsToolbar
        title={t("settings.mcpServers")}
        description={t("settings.mcpServersHint")}
        actions={<button className={buttonClassName("primary")} type="button" onClick={() => state.openForm()}><Plus size={14} /> {t("settings.addMcp")}</button>}
      />
      {servers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__title">{t("settings.noMcp")}</div>
          <div className="empty-state__body">{t("settings.noMcpBody")}</div>
          <button className={buttonClassName("primary")} type="button" onClick={() => state.openForm()}><Plus size={15} /> {t("settings.addMcp")}</button>
        </div>
      ) : (
        <div className="connection-list settings-resource-list">
          {servers.map((server) => {
            const busy = state.busyId === server.config.id;
            const statusClass = server.runtime.state === "connected" ? "available" : server.runtime.state === "failed" ? "unavailable" : "pending";
            return (
              <div key={server.config.id} className="connection-row settings-resource-row">
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
                    {server.secrets.map((secret) => <span key={`${secret.source}:${secret.key}`} className={`model-chip ${secret.status !== "configured" ? "empty" : ""}`}>{secret.status === "missing" ? t("settings.mcpSecretMissing") : secret.status === "unavailable" ? t("settings.mcpSecretUnavailable") : t("settings.mcpSecretConfigured")}</span>)}
                  </div>
                  {server.runtime.tools && server.runtime.tools.length > 0 && <div className="connection-meta mt-loom-2">{server.runtime.tools.map((tool) => `${tool.exposed ? "✓" : "—"} ${tool.title ?? tool.name}`).join(" · ")}</div>}
                  {server.runtime.diagnostics.length > 0 && <div className="warn-note">{server.runtime.diagnostics[server.runtime.diagnostics.length - 1].message}</div>}
                </div>
                <div className="settings-resource-actions">
                  <button className={iconButtonClassName()} type="button" disabled={busy} onClick={() => void state.toggle(server)} aria-label={server.config.enabled ? t("settings.mcpEnabled") : t("settings.mcpTest")} title={server.config.enabled ? t("settings.mcpEnabled") : t("settings.mcpTest")}><Power size={14} /></button>
                  <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void state.connect(server)} aria-label={t("settings.mcpTest")} title={t("settings.mcpTest")}><Radio size={14} /></button>
                  <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void state.connect(server, true)} aria-label={t("settings.mcpReconnect")} title={t("settings.mcpReconnect")}><RotateCcw size={14} /></button>
                  <button className={iconButtonClassName()} type="button" disabled={busy || !server.config.enabled} onClick={() => void state.refresh(server)} aria-label={t("settings.mcpRefresh")} title={t("settings.mcpRefresh")}><RefreshCw size={14} /></button>
                  <button className={iconButtonClassName()} type="button" onClick={() => state.openForm(server)} aria-label={t("settings.edit")} title={t("settings.edit")}><Pencil size={14} /></button>
                  <button className={iconButtonClassName("danger")} type="button" onClick={() => state.setPendingRemove(server)} aria-label={t("settings.mcpRemove")} title={t("settings.mcpRemove")}><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {state.error && <div className="warn-note" role="alert">{state.error}</div>}
      {state.snapshot?.diagnostics.map((diagnostic) => <div key={`${diagnostic.code}:${diagnostic.path}`} className="ok-note">{diagnostic.path}: {diagnostic.message}</div>)}

      <Modal open={state.formOpen} onOpenChange={(open) => { if (open || !formBusy) state.setFormOpen(open); }} ariaLabel={state.editing ? t("settings.editMcp") : t("settings.addMcp")}>
        <div className="settings-modal__panel mcp-settings-modal__panel w-[min(960px,calc(100vw-48px))]">
          <div className="settings-modal__head">
            <h3 className="mcp-dialog-title">{state.editing ? t("settings.editMcp") : t("settings.addMcp")}</h3>
            <button className={iconButtonClassName()} type="button" onClick={() => state.setFormOpen(false)} disabled={formBusy} aria-label={t("settings.close")} title={t("settings.close")}><X size={16} /></button>
          </div>
          <form className="mcp-form" onSubmit={(event) => { event.preventDefault(); void state.save(); }}>
            <div className="mcp-form-body">
              <section className="mcp-form-card mcp-form-card--identity">
                <label className="field"><span>名称</span><input value={state.form.name} onChange={(event) => state.setForm((current) => ({ ...current, name: event.target.value }))} placeholder="MCP server name" autoFocus /></label>
                <div className="mcp-type-row"><span>类型</span><McpTransportToggle value={state.form.transport} onChange={(transport) => state.setForm((current) => ({ ...current, transport }))} /></div>
              </section>
              <section className="mcp-form-card mcp-form-card--details">
                <div className="mcp-form-layout">
                  {state.form.transport === "stdio" ? (
                    <>
                      <div className="mcp-field-grid"><label className="field"><span>{t("settings.command")}</span><input value={state.form.command} onChange={(event) => state.setForm((current) => ({ ...current, command: event.target.value }))} placeholder="npx" /></label><label className="field"><span>{t("settings.workingDirectory")}</span><input value={state.form.cwd} onChange={(event) => state.setForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/absolute/project/path" /></label></div>
                      <McpStringRows label={t("settings.arguments")} values={state.form.args} placeholder="-y" onChange={(args) => state.setForm((current) => ({ ...current, args }))} />
                      <McpKeyValueRows label="环境变量" values={state.form.env} valuePlaceholder="环境变量名" onChange={(env) => state.setForm((current) => ({ ...current, env }))} />
                      <McpStringRows label="环境变量传递" values={state.form.inheritEnv} placeholder="PATH" onChange={(inheritEnv) => state.setForm((current) => ({ ...current, inheritEnv }))} />
                    </>
                  ) : (
                    <>
                      <label className="field"><span>{t("settings.endpoint")}</span><input value={state.form.url} onChange={(event) => state.setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://mcp.example.com/mcp" /></label>
                      <McpBearerCredentialField form={state.form} managedCredentialStorage={state.snapshot?.managedCredentialStorage} onChange={(update) => state.setForm((current) => ({ ...current, ...update }))} />
                      <McpKeyValueRows label="标头" values={state.form.headers} valuePlaceholder="值" onChange={(headers) => state.setForm((current) => ({ ...current, headers }))} />
                      <McpKeyValueRows label="来自环境变量的标头" values={state.form.headerEnv} valuePlaceholder="环境变量名" onChange={(headerEnv) => state.setForm((current) => ({ ...current, headerEnv }))} />
                    </>
                  )}
                </div>
              </section>
            </div>
            <div className="mcp-form-error" role="alert" aria-live="polite">{state.error ?? ""}</div>
            <div className="mcp-form-actions"><button className={buttonClassName("primary")} type="submit" disabled={formBusy}>{formBusy ? t("settings.mcpSaving") : t("settings.mcpSave")}</button></div>
          </form>
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(state.pendingRemove)} onOpenChange={(open) => { if (!open) state.setPendingRemove(null); }} title={t("settings.mcpRemove")} description={state.pendingRemove ? t("settings.mcpRemoveDescription", { name: state.pendingRemove.config.name }) : undefined} onConfirm={() => void state.remove()} />
      <ConfirmDialog open={Boolean(state.pendingConsent)} onOpenChange={(open) => { if (!open) state.setPendingConsent(null); }} title={t("settings.mcpConsentTitle")} description={state.pendingConsent ? <div className="grid gap-loom-2 whitespace-pre-wrap font-loom-mono text-[10.5px] text-loom-muted"><p>{t("settings.mcpConsentBody")}</p><div><strong>{t("settings.mcpCommand")}:</strong> {state.pendingConsent.config.transport.command ?? state.pendingConsent.config.transport.url}</div>{state.pendingConsent.config.transport.args && <div><strong>{t("settings.mcpArgs")}:</strong> {state.pendingConsent.config.transport.args.join(" ")}</div>}{state.pendingConsent.config.transport.cwd && <div><strong>{t("settings.mcpCwd")}:</strong> {state.pendingConsent.config.transport.cwd}</div>}{state.pendingConsent.config.transport.environmentNames && <div><strong>{t("settings.mcpEnv")}:</strong> {state.pendingConsent.config.transport.environmentNames.join(", ") || "—"}</div>}{state.pendingConsent.config.transport.privilegeWarning && <div className="text-loom-warn"><strong>{state.pendingConsent.config.transport.privilegeWarning}</strong></div>}</div> : undefined} confirmLabel={t("settings.mcpConsent")} onConfirm={() => void state.consent()} />
    </>
  );
}
