import type { Api } from "@earendil-works/pi-ai";
import type { CatalogDiagnostic, NormalizedCatalogModel, NormalizedCatalogProvider } from "./types";

type JsonObject = Record<string, unknown>;

export interface ModelsDevCatalogPayload {
  models?: Record<string, unknown>;
  providers?: Record<string, unknown>;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function apiForProvider(providerId: string, provider: JsonObject): Api | undefined {
  const npm = stringValue(provider.npm)?.toLowerCase() ?? "";
  if (npm.includes("anthropic")) return "anthropic-messages";
  if (npm.includes("google") || npm.includes("vertex")) return npm.includes("vertex") ? "google-vertex" : "google-generative-ai";
  if (npm.includes("mistral")) return "mistral-conversations";
  if (npm.includes("openai-compatible") || npm.includes("openai")) return "openai-completions";

  switch (providerId) {
    case "anthropic": return "anthropic-messages";
    case "google": return "google-generative-ai";
    case "google-vertex": return "google-vertex";
    case "mistral": return "mistral-conversations";
    case "openai": return "openai-responses";
    default: return undefined;
  }
}

function modelIdForProvider(id: string, providerId: string) {
  const prefix = `${providerId}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function costValue(cost: JsonObject | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = finiteNumber(cost?.[key]);
    if (value !== undefined && value >= 0) return value;
  }
  return 0;
}

function normalizeInput(model: JsonObject): Array<"text" | "image"> {
  const modalities = recordValue(model.modalities);
  const input = Array.isArray(modalities?.input) ? modalities.input : [];
  const normalized = input.filter((item): item is "text" | "image" => item === "text" || item === "image");
  return normalized.includes("text") ? normalized : ["text", ...normalized];
}

function normalizeModel(providerId: string, provider: JsonObject, rawId: string, raw: JsonObject, fetchedAt: string): NormalizedCatalogModel {
  const diagnostics: CatalogDiagnostic[] = [];
  const api = apiForProvider(providerId, provider);
  const providerName = stringValue(provider.name) ?? providerId;
  const id = modelIdForProvider(stringValue(raw.id) ?? rawId, providerId);
  const modelName = stringValue(raw.name) ?? id;
  const limit = recordValue(raw.limit);
  const cost = recordValue(raw.cost);
  const contextWindow = finiteNumber(limit?.context) ?? 0;
  const maxTokens = finiteNumber(limit?.output) ?? 0;

  if (!api) diagnostics.push({ code: "unsupported-api", field: "provider.npm", message: `No supported pi-ai API mapping for provider ${providerId}.` });
  if (!contextWindow || contextWindow < 1) diagnostics.push({ code: "missing-context-window", field: "limit.context", message: `${providerName}/${id} has no valid context window.` });
  if (!maxTokens || maxTokens < 1) diagnostics.push({ code: "missing-max-tokens", field: "limit.output", message: `${providerName}/${id} has no valid maximum output.` });

  const baseUrl = stringValue(provider.api);
  const compat: Record<string, unknown> = {};
  if (raw.tool_call === false) compat.supportsToolCalls = false;
  if (raw.structured_output === false) compat.supportsStructuredOutput = false;

  return {
    providerId,
    modelId: id,
    name: modelName,
    api: api ?? "unsupported",
    baseUrl,
    reasoning: raw.reasoning === true,
    input: normalizeInput(raw),
    contextWindow,
    maxTokens,
    cost: {
      input: costValue(cost, "input", "prompt"),
      output: costValue(cost, "output", "completion"),
      cacheRead: costValue(cost, "cache_read", "input_cache_read"),
      cacheWrite: costValue(cost, "cache_write", "input_cache_write"),
    },
    compat: Object.keys(compat).length ? compat : undefined,
    source: "models-dev",
    sourceUrl: stringValue(provider.doc),
    lastVerifiedAt: stringValue(raw.last_updated) ?? fetchedAt,
    diagnostics,
  };
}

export function normalizeModelsDevCatalog(payload: unknown, fetchedAt = new Date().toISOString()): { providers: NormalizedCatalogProvider[]; diagnostics: CatalogDiagnostic[] } {
  const diagnostics: CatalogDiagnostic[] = [];
  if (!isObject(payload)) return { providers: [], diagnostics: [{ code: "invalid-catalog", message: "Models.dev catalog must be a JSON object." }] };
  const providersRaw = recordValue(payload.providers);
  if (!providersRaw) return { providers: [], diagnostics: [{ code: "missing-providers", field: "providers", message: "Models.dev catalog has no providers object." }] };

  const providers: NormalizedCatalogProvider[] = [];
  for (const [providerId, rawProvider] of Object.entries(providersRaw)) {
    if (!isObject(rawProvider)) {
      diagnostics.push({ code: "invalid-provider", field: `providers.${providerId}`, message: "Provider entry must be an object." });
      continue;
    }
    const rawModels = recordValue(rawProvider.models);
    if (!rawModels) continue;
    const api = apiForProvider(providerId, rawProvider);
    const models = Object.entries(rawModels).filter((entry): entry is [string, JsonObject] => isObject(entry[1])).map(([id, model]) => normalizeModel(providerId, rawProvider, id, model, fetchedAt));
    providers.push({
      id: providerId,
      name: stringValue(rawProvider.name) ?? providerId,
      baseUrl: stringValue(rawProvider.api),
      api,
      models,
    });
  }
  return { providers, diagnostics };
}

export function catalogCounts(providers: NormalizedCatalogProvider[]) {
  return { providerCount: providers.length, modelCount: providers.reduce((total, provider) => total + provider.models.length, 0) };
}
