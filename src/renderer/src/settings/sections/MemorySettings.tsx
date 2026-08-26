import { useCallback, useEffect, useMemo } from "react";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { LoomCheckboxField } from "../../ui/controls";
import { SettingsSaveBar } from "../components/SettingsSection";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { MemoryManagementPanel } from "../../memory/MemoryPanel";

export function MemorySettings({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const initial = useMemo(() => ({
    enabled: ctx.settings?.memory?.enabled ?? false,
    backgroundExtraction: ctx.settings?.memory?.backgroundExtraction ?? false,
    autoDream: ctx.settings?.memory?.autoDream ?? false,
  }), [ctx.settings?.memory?.autoDream, ctx.settings?.memory?.backgroundExtraction, ctx.settings?.memory?.enabled]);
  const save = useCallback(async (value: typeof initial) => {
    await window.api?.settings?.set({ memory: value });
    ctx.reloadSettings();
  }, [ctx]);
  const draft = useSettingsDraft({ initial, onSave: save });
  useEffect(() => {
    ctx.setSettingsSectionState?.({ dirty: draft.dirty, save: draft.save, discard: draft.discard });
    return () => ctx.setSettingsSectionState?.(null);
  }, [ctx.setSettingsSectionState, draft.discard, draft.dirty, draft.save]);
  if (!ctx.settings) return null;

  return (
    <div className="grid min-w-0 gap-loom-6">
      <section aria-labelledby="memory-config-title">
        <div className="settings-domain-head">
          <div className="settings-toolbar__copy"><h2 id="memory-config-title">{t("settings.memoryConfig")}</h2><p>{t("settings.memoryHelp")}</p></div>
        </div>
        <div className="settings-memory-options">
          <LoomCheckboxField checked={draft.draft.enabled} onCheckedChange={(enabled) => draft.setDraft((current) => ({ ...current, enabled }))} label={t("settings.enableMemory")} />
          <LoomCheckboxField checked={draft.draft.backgroundExtraction} onCheckedChange={(backgroundExtraction) => draft.setDraft((current) => ({ ...current, backgroundExtraction }))} disabled={!draft.draft.enabled} label={t("settings.extractCandidates")} description={<em className="src">{t("settings.memoryDefaultOff")}</em>} />
          <LoomCheckboxField checked={draft.draft.autoDream} onCheckedChange={(autoDream) => draft.setDraft((current) => ({ ...current, autoDream }))} disabled={!draft.draft.enabled} label={t("settings.allowAutoDream")} />
        </div>
        <SettingsSaveBar {...draft} onSave={draft.save} onDiscard={draft.discard} />
      </section>
      <section aria-labelledby="memory-management-title">
        <div className="settings-domain-head"><div className="settings-toolbar__copy"><h2 id="memory-management-title">{t("settings.memoryManagement")}</h2><p>{t("settings.memoryManagementHelp")}</p></div></div>
        <MemoryManagementPanel project={ctx.projects?.find((project) => project.id === ctx.activeProjectId)} enabled={ctx.settings.memory?.enabled ?? false} autoDreamEnabled={Boolean(ctx.settings.memory?.enabled && ctx.settings.memory?.autoDream)} />
      </section>
    </div>
  );
}
