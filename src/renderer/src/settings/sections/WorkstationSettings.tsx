import { useCallback, useEffect, useMemo } from "react";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { LoomCheckboxField } from "../../ui/controls";
import { SettingsSaveBar } from "../components/SettingsSection";
import { useSettingsDraft } from "../hooks/useSettingsDraft";

export function WorkstationSettings({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const initial = useMemo(() => ({ notify: ctx.settings?.monitor.notify ?? true }), [ctx.settings?.monitor.notify]);
  const save = useCallback(async (value: typeof initial) => {
    await window.api?.settings?.set({ monitor: value });
    await window.api?.monitor?.setNotify?.(value.notify);
    ctx.reloadSettings();
  }, [ctx]);
  const draft = useSettingsDraft({ initial, onSave: save });
  useEffect(() => {
    ctx.setSettingsSectionState?.({ dirty: draft.dirty, save: draft.save, discard: draft.discard });
    return () => ctx.setSettingsSectionState?.(null);
  }, [ctx.setSettingsSectionState, draft.discard, draft.dirty, draft.save]);
  if (!ctx.settings) return null;
  return (
    <>
      <LoomCheckboxField checked={draft.draft.notify} onCheckedChange={(notify) => draft.setDraft({ notify })} label={t("settings.monitorNotification")} />
      <SettingsSaveBar {...draft} onSave={draft.save} onDiscard={draft.discard} />
    </>
  );
}
