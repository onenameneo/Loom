import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { iconButtonClassName } from "../ui/styles";

export type CatalogRefreshStatus = "updated" | "not-modified" | "offline-fallback" | "invalid-response" | "failed";
export type CatalogRefreshResult = { status: CatalogRefreshStatus };

export function ModelCatalogRefreshButton({ onRefresh, label }: { onRefresh?: () => Promise<CatalogRefreshResult | void>; label: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<CatalogRefreshStatus | null>(null);
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
            setStatus(result?.status ?? null);
          } finally { setBusy(false); }
        }}
      >
        <RefreshCw size={16} className={busy ? "animate-spin" : undefined} />
      </button>
      {status && <span className="src" role="status">{status}</span>}
    </>
  );
}
