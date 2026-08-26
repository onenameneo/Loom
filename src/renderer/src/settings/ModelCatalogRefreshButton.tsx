import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { useToast } from "../ui/ToastProvider";
import { iconButtonClassName } from "../ui/styles";

export type CatalogRefreshStatus = "updated" | "not-modified" | "offline-fallback" | "invalid-response" | "failed";
export type CatalogRefreshResult = { status: CatalogRefreshStatus; providerCount?: number; modelCount?: number };

export function ModelCatalogRefreshButton({ onRefresh, label }: { onRefresh?: () => Promise<CatalogRefreshResult | void>; label: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!onRefresh) return null;
  return (
    <>
      <button
        className={iconButtonClassName()}
        type="button"
        disabled={busy}
        aria-label={label}
        title={label}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await onRefresh();
            if (result) {
              const messageKey = result.status === "updated"
                ? "settings.modelCatalogUpdated"
                : result.status === "not-modified"
                  ? "settings.modelCatalogCurrent"
                  : result.status === "offline-fallback"
                    ? "settings.modelCatalogOffline"
                    : result.status === "invalid-response"
                      ? "settings.modelCatalogInvalid"
                      : "settings.modelCatalogRefreshFailed";
              const tone = result.status === "failed" || result.status === "invalid-response" ? "error" : result.status === "offline-fallback" ? "info" : "success";
              showToast(t(messageKey, result.providerCount && result.modelCount ? { providers: result.providerCount, models: result.modelCount } : undefined), tone);
            }
          } catch {
            showToast(t("settings.modelCatalogRefreshFailed"), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={16} className={busy ? "animate-spin" : undefined} />
      </button>
    </>
  );
}
