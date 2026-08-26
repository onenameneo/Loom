import type { ReactNode, Ref } from "react";
import { Check, Save } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { buttonClassName, cn } from "../../ui/styles";

export function SettingsSectionFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("settings-section-frame", className)}>{children}</section>;
}

export function SettingsToolbar({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-toolbar settings-toolbar--settings">
      <div className="settings-toolbar__copy">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
      {actions && <div className="settings-toolbar__actions">{actions}</div>}
    </div>
  );
}

export function SettingsSaveBar({
  dirty,
  saving,
  saved,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-save-bar">
      <div className="settings-save-bar__status" aria-live="polite">
        {error && <span className="settings-save-bar__error" role="alert">{error}</span>}
        {!error && saved && <span className="settings-save-bar__saved"><Check size={14} aria-hidden="true" /> {t("settings.saved")}</span>}
      </div>
      <div className="settings-save-bar__actions">
        {dirty && onDiscard && <button className={buttonClassName()} type="button" onClick={onDiscard} disabled={saving}>{t("common.cancel")}</button>}
        <button className={buttonClassName("primary")} type="button" onClick={() => void onSave()} disabled={!dirty || saving}>
          <Save size={14} aria-hidden="true" /> {saving ? t("settings.saving") : t("settings.save")}
        </button>
      </div>
    </div>
  );
}

export function SettingsFieldGroup({ children }: { children: ReactNode }) {
  return <div className="settings-field-group">{children}</div>;
}

export function SettingsSectionHeader({
  eyebrow,
  title,
  description,
  headingRef,
}: {
  eyebrow: string;
  title: string;
  description: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="settings-page__head">
      <div className="settings-page__eyebrow">{eyebrow}</div>
      <h1 id="settings-page-title" ref={headingRef} tabIndex={-1}>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
