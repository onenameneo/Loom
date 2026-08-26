import { useI18n } from "../i18n/I18nProvider";
import { buttonClassName } from "../ui/styles";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";

export function ModelAuthenticationFields({
  baseUrl,
  apiKey,
  onBaseUrlChange,
  onApiKeyChange,
  authMethods = [],
  configuredAuthTypes = [],
  authBusy = false,
  authMessage,
  onLogin,
  onLogout,
}: {
  baseUrl: string;
  apiKey: string;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  authMethods?: Array<{ type: "api_key" | "oauth"; label: string; isSubscription?: boolean; loginLabel?: string }>;
  configuredAuthTypes?: Array<"api_key" | "oauth">;
  authBusy?: boolean;
  authMessage?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}) {
  const { t } = useI18n();
  const hasApiKey = authMethods.length === 0 || authMethods.some((method) => method.type === "api_key");
  const subscription = authMethods.find((method) => method.type === "oauth");
  const subscriptionConnected = configuredAuthTypes.includes("oauth");
  return (
    <>
      <label className="field">
        <span>Base URL</span>
        <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" />
      </label>
      <div className="model-auth settings-grid__wide">
        <div className="model-auth__head"><span>认证方式</span><span className="model-auth__methods">{authMethods.map((method) => <span key={method.type} className="model-auth__badge">{method.type === "oauth" ? t("settings.subscriptionAuth") : t("settings.apiKeyAuth")}</span>)}</span></div>
        {hasApiKey && <label className="field model-auth__key"><span>{t("settings.apiKeyAuth")}</span><input type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={t("settings.apiKeyPlaceholder")} /></label>}
        {subscription && <div className={`model-auth__subscription ${subscriptionConnected ? "connected" : ""}`}>
          <div className="model-auth__subscription-copy"><ShieldCheck size={16} aria-hidden="true" /><span><strong>{subscription.label}</strong><small>{subscriptionConnected ? t("settings.subscriptionConnected") : t("settings.subscriptionHelp")}</small></span></div>
          {subscriptionConnected ? <button className={buttonClassName()} type="button" onClick={onLogout} disabled={authBusy}><LogOut size={14} />{t("settings.signOutSubscription")}</button> : <button className={buttonClassName("primary")} type="button" onClick={onLogin} disabled={authBusy}><LogIn size={14} />{authBusy ? "…" : (subscription.loginLabel ?? t("settings.signInSubscription"))}</button>}
        </div>}
        {authMessage && <p className="model-auth__message" role="status">{authMessage}</p>}
      </div>
    </>
  );
}
