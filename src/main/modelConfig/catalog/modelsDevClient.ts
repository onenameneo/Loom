import type { CatalogDiagnostic, CatalogSnapshot } from "./types";
import { normalizeModelsDevCatalog, catalogCounts } from "./normalize";

export const MODELS_DEV_ENDPOINT = "https://models.dev/catalog.json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface ModelsDevClientOptions {
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ModelsDevFetchResult {
  snapshot?: CatalogSnapshot;
  notModified: boolean;
  etag?: string;
  diagnostics: CatalogDiagnostic[];
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`Models.dev response exceeds ${maxBytes} bytes.`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error(`Models.dev response exceeds ${maxBytes} bytes.`);
  return body;
}

export async function fetchModelsDevCatalog(options: ModelsDevClientOptions = {}, previous?: CatalogSnapshot): Promise<ModelsDevFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? MODELS_DEV_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (previous?.etag) headers["if-none-match"] = previous.etag;
    const response = await fetchImpl(endpoint, { method: "GET", headers, signal: controller.signal });
    if (response.status === 304) return { notModified: true, etag: previous?.etag, diagnostics: [] };
    if (!response.ok) return { notModified: false, diagnostics: [{ code: "catalog-http", message: `Models.dev returned HTTP ${response.status}.` }] };
    const payload = JSON.parse(await readBoundedBody(response, maxBytes)) as unknown;
    const fetchedAt = new Date().toISOString();
    const normalized = normalizeModelsDevCatalog(payload, fetchedAt);
    if (normalized.providers.length === 0) return { notModified: false, diagnostics: [...normalized.diagnostics, { code: "empty-catalog", message: "Models.dev returned no usable providers." }] };
    const snapshot: CatalogSnapshot = {
      schemaVersion: 1,
      source: "models.dev",
      fetchedAt,
      etag: response.headers.get("etag") ?? undefined,
      providers: normalized.providers,
    };
    return { snapshot, notModified: false, etag: snapshot.etag, diagnostics: normalized.diagnostics };
  } catch (error) {
    return {
      notModified: false,
      diagnostics: [{ code: controller.signal.aborted ? "catalog-timeout" : "catalog-fetch", message: error instanceof Error ? error.message : "Unable to fetch Models.dev catalog." }],
    };
  } finally {
    clearTimeout(timer);
  }
}

export function catalogResultCounts(snapshot?: CatalogSnapshot) {
  const counts = catalogCounts(snapshot?.providers ?? []);
  return counts;
}
