import type { McpFormState } from "./mcpForm";
import { useI18n } from "../i18n/I18nProvider";

export function McpBearerCredentialField({
  form,
  onChange,
  managedCredentialStorage = "available",
}: {
  form: McpFormState;
  onChange: (update: Partial<McpFormState>) => void;
  managedCredentialStorage?: "available" | "unavailable";
}) {
  const { t } = useI18n();
  const managedUnavailable = managedCredentialStorage === "unavailable";
  const managed = form.bearerCredentialSource === "managed";
  const describedBy = managed ? "mcp-managed-credential-help" : "mcp-environment-credential-help";

  return (
    <div className="field" data-testid="mcp-bearer-credential">
      <span>{t("settings.mcpBearerToken")}</span>
      <div className="flex flex-wrap items-center gap-loom-3" role="radiogroup" aria-label={t("settings.mcpCredentialSource")}>
        <label className="flex items-center gap-loom-1 text-loom-text">
          <input
            type="radio"
            name="mcp-bearer-source"
            checked={managed}
            disabled={managedUnavailable}
            onChange={() => onChange({ bearerCredentialSource: "managed", clearManagedBearer: false })}
          />
          {t("settings.mcpManagedCredential")}
        </label>
        <label className="flex items-center gap-loom-1 text-loom-text">
          <input
            type="radio"
            name="mcp-bearer-source"
            checked={!managed}
            onChange={() => onChange({ bearerCredentialSource: "environment", clearManagedBearer: false })}
          />
          {t("settings.mcpEnvironmentCredential")}
        </label>
      </div>
      {managed ? (
        <>
          <input
            aria-label={t("settings.mcpBearerToken")}
            type="password"
            value={form.bearerToken}
            disabled={managedUnavailable}
            autoComplete="new-password"
            placeholder={form.managedCredentialConfigured ? t("settings.mcpCredentialKeep") : t("settings.mcpBearerTokenPlaceholder")}
            aria-describedby={describedBy}
            onChange={(event) => onChange({ bearerToken: event.target.value, clearManagedBearer: false })}
          />
          <div id="mcp-managed-credential-help" className="text-loom-muted text-[11px]" aria-live="polite">
            {managedUnavailable
              ? t("settings.mcpManagedUnavailable")
              : form.managedCredentialStatus === "missing"
                ? t("settings.mcpCredentialMissingReplace")
                : form.managedCredentialConfigured
                ? t("settings.mcpCredentialConfiguredKeep")
                : t("settings.mcpCredentialSaved")}
          </div>
          {(form.managedCredentialConfigured || form.managedCredentialReference) && !managedUnavailable && (
            <button
              className="mcp-add-row self-start"
              type="button"
              onClick={() => onChange({ clearManagedBearer: true, bearerToken: "" })}
            >
              {t("settings.mcpClearCredential")}
            </button>
          )}
        </>
      ) : (
        <>
          <input
            aria-label={t("settings.mcpBearerEnvironment")}
            value={form.bearerTokenEnv}
            placeholder="MCP_BEARER_TOKEN"
            aria-describedby={describedBy}
            onChange={(event) => onChange({ bearerTokenEnv: event.target.value, clearManagedBearer: false })}
          />
          <div id="mcp-environment-credential-help" className="text-loom-muted text-[11px]">
            {t("settings.mcpEnvironmentCredentialHelp")}
          </div>
        </>
      )}
    </div>
  );
}
