import { useCallback, useEffect, useMemo } from "react";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { LoomCheckboxField, LoomSelect, LoomSelectItem } from "../../ui/controls";
import { SettingsSaveBar } from "../components/SettingsSection";
import { useSettingsDraft } from "../hooks/useSettingsDraft";

const DEFAULT_PROFILE = "auto-edit" as const;

export function PermissionsSettings({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const permissions = ctx.settings?.permissions;
  const initial = useMemo(() => ({
    profile: permissions?.profile ?? DEFAULT_PROFILE,
    approvalsReviewer: permissions?.approvalsReviewer ?? "user",
    networkAccess: permissions?.networkAccess ?? false,
  }), [permissions?.approvalsReviewer, permissions?.networkAccess, permissions?.profile]);
  const save = useCallback(async (value: typeof initial) => {
    await window.api?.settings?.setPermissions(value);
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
      <p className="settings-help">{t("settings.permissionsHelp")}</p>
      <div className="settings-form-grid">
        <label className="field">
          <span>{t("settings.permissionMode")}</span>
          <LoomSelect value={draft.draft.profile} onValueChange={(profile) => draft.setDraft((current) => ({ ...current, profile: profile as typeof current.profile }))} placeholder={t("settings.choosePermissionMode")} ariaLabel={t("settings.permissionMode")}>
            <LoomSelectItem value="suggest">{t("settings.profileSuggest")}</LoomSelectItem>
            <LoomSelectItem value="auto-edit">{t("settings.profileAutoEdit")}</LoomSelectItem>
            <LoomSelectItem value="full-auto">{t("settings.profileFullAuto")}</LoomSelectItem>
            <LoomSelectItem value="full-access">{t("settings.profileFullAccess")}</LoomSelectItem>
          </LoomSelect>
        </label>
        <label className="field">
          <span>{t("settings.reviewer")}</span>
          <LoomSelect value={draft.draft.approvalsReviewer} onValueChange={(approvalsReviewer) => draft.setDraft((current) => ({ ...current, approvalsReviewer: approvalsReviewer as typeof current.approvalsReviewer }))} placeholder={t("settings.chooseReviewer")} ariaLabel={t("settings.reviewer")}>
            <LoomSelectItem value="user">{t("settings.me")}</LoomSelectItem>
            <LoomSelectItem value="auto-review">{t("settings.autoReview")}</LoomSelectItem>
          </LoomSelect>
        </label>
      </div>
      <LoomCheckboxField checked={draft.draft.networkAccess} onCheckedChange={(networkAccess) => draft.setDraft((current) => ({ ...current, networkAccess }))} label={t("settings.network")} />
      <div className="ok-note">{t("settings.recommended")}</div>
      <SettingsSaveBar {...draft} onSave={draft.save} onDiscard={draft.discard} />
    </>
  );
}
