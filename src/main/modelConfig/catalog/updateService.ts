import { homedir } from "node:os";
import { modelsDevCatalogCachePath } from "../paths";
import { readCatalogCache, writeCatalogCache } from "./cache";
import { catalogResultCounts, fetchModelsDevCatalog, type ModelsDevClientOptions } from "./modelsDevClient";
import type { CatalogDiagnostic, CatalogUpdateResult } from "./types";

const FRESHNESS_MS = 24 * 60 * 60 * 1000;

function countFromCache(homeDir: string) {
  const cached = readCatalogCache(modelsDevCatalogCachePath(homeDir));
  return { cached, ...catalogResultCounts(cached.snapshot) };
}

export function catalogNeedsRefresh(fetchedAt: string | undefined, now = Date.now()) {
  if (!fetchedAt) return true;
  const parsed = Date.parse(fetchedAt);
  return !Number.isFinite(parsed) || now - parsed >= FRESHNESS_MS;
}

export async function refreshModelsDevCatalog(options: { homeDir?: string; client?: ModelsDevClientOptions; force?: boolean } = {}): Promise<CatalogUpdateResult> {
  const homeDir = options.homeDir ?? homedir();
  const { cached, providerCount, modelCount } = countFromCache(homeDir);
  if (!options.force && cached.snapshot && !catalogNeedsRefresh(cached.snapshot.fetchedAt)) {
    return { status: "not-modified", fetchedAt: cached.snapshot.fetchedAt, providerCount, modelCount, diagnostics: [] };
  }

  const result = await fetchModelsDevCatalog(options.client, cached.snapshot);
  if (result.notModified) {
    return {
      status: "not-modified",
      fetchedAt: cached.snapshot?.fetchedAt,
      providerCount,
      modelCount,
      diagnostics: result.diagnostics,
    };
  }
  if (result.snapshot) {
    writeCatalogCache(modelsDevCatalogCachePath(homeDir), result.snapshot);
    const counts = catalogResultCounts(result.snapshot);
    return {
      status: "updated",
      fetchedAt: result.snapshot.fetchedAt,
      ...counts,
      diagnostics: result.diagnostics,
    };
  }

  const diagnostics: CatalogDiagnostic[] = result.diagnostics.length
    ? result.diagnostics
    : [{ code: "catalog-refresh-failed", message: "Unable to update Models.dev catalog." }];
  return {
    status: cached.snapshot ? "offline-fallback" : "failed",
    fetchedAt: cached.snapshot?.fetchedAt,
    providerCount,
    modelCount,
    diagnostics,
  };
}
