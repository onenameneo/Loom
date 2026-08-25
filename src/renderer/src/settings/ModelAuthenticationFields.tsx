import { useI18n } from "../i18n/I18nProvider";

export function ModelAuthenticationFields({
  baseUrl,
  apiKey,
  onBaseUrlChange,
  onApiKeyChange,
}: {
  baseUrl: string;
  apiKey: string;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="field">
        <span>Base URL</span>
        <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" />
      </label>
      <label className="field settings-grid__wide">
        <span>API key</span>
        <input type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={t("settings.apiKeyPlaceholder")} />
      </label>
    </>
  );
}
