import { useCallback, useEffect, useMemo } from "react";
import type { Locale } from "../../i18n/i18n";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { LoomSelect, LoomSelectItem } from "../../ui/controls";
import { SettingsSaveBar } from "../components/SettingsSection";
import { useSettingsDraft } from "../hooks/useSettingsDraft";

export function AppearanceSettings({ ctx }: { ctx: SurfaceCtx }) {
  const { locale, setLocale, t } = useI18n();
  const initial = useMemo(() => ({ locale, theme: ctx.settings?.appearance.theme ?? "system" }), [ctx.settings?.appearance.theme, locale]);
  const save = useCallback(async (value: typeof initial) => {
    await window.api?.settings?.set({ appearance: { theme: value.theme } });
    setLocale(value.locale);
    ctx.reloadSettings();
  }, [ctx, setLocale]);
  const draft = useSettingsDraft({ initial, onSave: save });
  useEffect(() => {
    ctx.setSettingsSectionState?.({ dirty: draft.dirty, save: draft.save, discard: draft.discard });
    return () => ctx.setSettingsSectionState?.(null);
  }, [ctx.setSettingsSectionState, draft.discard, draft.dirty, draft.save]);
  if (!ctx.settings) return null;

  return (
    <>
      <div className="settings-form-grid">
        <label className="field">
          <span>{t("settings.language")}</span>
          <LoomSelect value={draft.draft.locale} onValueChange={(value) => draft.setDraft((current) => ({ ...current, locale: value as Locale }))} placeholder={t("settings.language")} ariaLabel={t("settings.language")}>
            <LoomSelectItem value="zh-CN">{t("settings.languageChinese")}</LoomSelectItem>
            <LoomSelectItem value="en">{t("settings.languageEnglish")}</LoomSelectItem>
          </LoomSelect>
          <em className="src">{t("settings.languageHelp")}</em>
        </label>
        <label className="field">
          <span>{t("settings.theme")}</span>
          <LoomSelect value={draft.draft.theme} onValueChange={(value) => draft.setDraft((current) => ({ ...current, theme: value as typeof current.theme }))} placeholder={t("settings.theme")} ariaLabel={t("settings.theme")}>
            <LoomSelectItem value="system">{t("settings.system")}</LoomSelectItem>
            <LoomSelectItem value="light">{t("settings.light")}</LoomSelectItem>
            <LoomSelectItem value="dark">{t("settings.dark")}</LoomSelectItem>
          </LoomSelect>
        </label>
      </div>
      <SettingsSaveBar {...draft} onSave={draft.save} onDiscard={draft.discard} />
    </>
  );
}
