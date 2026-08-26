import { useState } from "react";
import { Eye, FolderOpen, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { SkillCatalogDto } from "../../env";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { ConfirmDialog, Modal } from "../../ui/dialogs";
import { buttonClassName, iconButtonClassName } from "../../ui/styles";
import { SettingsToolbar } from "../components/SettingsSection";
import { useSkillsCatalog } from "../hooks/useSkillsCatalog";

export function SkillsSettings({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const { catalog, error, reload, addSource, removeSource } = useSkillsCatalog(ctx);
  const [sourceDraft, setSourceDraft] = useState("");
  const [selectedSource, setSelectedSource] = useState<SkillCatalogDto["sources"][number] | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  async function submitSource() {
    const path = sourceDraft.trim();
    if (!path) return;
    await addSource(path);
    setSourceDraft("");
  }

  const sourceSkills = (catalog?.skills ?? []).filter((skill) => selectedSource && (skill.sourceId === selectedSource.id || skill.rootPath === selectedSource.rootPath));

  return (
    <>
      <SettingsToolbar
        title={t("settings.skillSources")}
        description={t("settings.skillSourcesHint")}
        actions={(
          <div className="settings-toolbar__source-actions">
            <input value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} placeholder="/path/to/skills" />
            <button className={buttonClassName("primary")} type="button" onClick={() => void submitSource()}><Plus size={14} /> {t("settings.addSkillSource")}</button>
            <button className={buttonClassName()} type="button" onClick={() => void reload()}><RefreshCw size={14} /> {t("settings.scanSkills")}</button>
          </div>
        )}
      />
      {error && <div className="warn-note" role="alert">{error}</div>}
      <div className="connection-list settings-resource-list">
        {(catalog?.sources ?? []).map((source) => (
          <div key={source.id} className="connection-row settings-resource-row">
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
            <div className="settings-resource-actions">
              <button className={iconButtonClassName()} type="button" aria-label={t("settings.viewSkills")} title={t("settings.viewSkills")} onClick={() => { setSelectedSource(source); setDetailOpen(true); }}><Eye size={15} /></button>
              <button className={iconButtonClassName()} type="button" aria-label={t("settings.openDirectory")} title={t("settings.openDirectory")} onClick={() => void window.api?.settings?.openSkillSource?.(source.rootPath)}><FolderOpen size={15} /></button>
              {source.registered && <button className={iconButtonClassName("danger")} type="button" onClick={() => setPendingRemove(source.rootPath)} aria-label={`${t("settings.removeSource")} ${source.rootPath}`} title={t("settings.removeSource")}><Trash2 size={15} /></button>}
            </div>
          </div>
        ))}
        {(catalog?.sources.length ?? 0) === 0 && <div className="empty-state compact"><div className="empty-state__title">{t("settings.noSkillSources")}</div></div>}
      </div>
      <ConfirmDialog open={Boolean(pendingRemove)} onOpenChange={(open) => { if (!open) setPendingRemove(null); }} title={t("settings.removeSource")} description={pendingRemove ?? undefined} onConfirm={() => { if (pendingRemove) void removeSource(pendingRemove); setPendingRemove(null); }} />
      <Modal open={detailOpen} onOpenChange={setDetailOpen} ariaLabel={`${selectedSource?.scope === "project" ? t("settings.projectSource") : t("settings.globalSource")} Skills`}>
        <div className="settings-modal__panel" onClick={(event) => event.stopPropagation()}>
          <div className="settings-modal__head">
            <div>
              <h3>{selectedSource?.scope === "project" ? (selectedSource.projectName ?? t("settings.projectSource")) : t("settings.globalSource")} · Skills</h3>
              <div className="connection-meta">{selectedSource?.rootPath ?? ""} · {selectedSource?.trusted ? "trusted" : "untrusted"}</div>
            </div>
            <button className={iconButtonClassName()} type="button" onClick={() => setDetailOpen(false)} aria-label={t("settings.closeSkills")} title={t("settings.closeSkills")}><X size={16} /></button>
          </div>
          <div className="skills-list skill-detail__list">
            {sourceSkills.map((skill) => (
              <div key={`${skill.sourceId}:${skill.id}:${skill.rootPath}`} className={`skill-detail__row ${skill.active ? "" : "muted"}`}>
                <div className="connection-title-row">
                  <div>
                    <div className="connection-name">{skill.name}</div>
                    <div className="connection-meta">{skill.id} · {skill.hash}</div>
                  </div>
                  <span className={`status-pill ${skill.active ? "available" : "unavailable"}`}>{skill.active ? t("settings.active") : t("settings.overridden")}</span>
                </div>
                <div className="ok-note skill-summary">{skill.description || t("settings.noDescription")}</div>
                {skill.diagnostics.map((diagnostic) => <div key={`${diagnostic.code}:${diagnostic.path ?? ""}`} className={diagnostic.level === "error" ? "warn-note" : "ok-note"}>{diagnostic.code}: {diagnostic.message}</div>)}
              </div>
            ))}
            {sourceSkills.length === 0 && <div className="empty-state compact"><div className="empty-state__title">{t("settings.noSkillsFound")}</div></div>}
          </div>
        </div>
      </Modal>
    </>
  );
}
