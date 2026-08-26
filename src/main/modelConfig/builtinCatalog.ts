import type { Api, Model } from "@earendil-works/pi-ai";
import type { BuiltinCatalog, RegistryModel, RegistryProvider } from "./types";
import { supportedThinkingLevels } from "./thinkingLevels";
import { readCatalogCache } from "./catalog/cache";
import { embeddedCatalogProviders } from "./catalog/embeddedCatalog";
import { modelsDevCatalogCachePath } from "./paths";
import type { NormalizedCatalogModel, NormalizedCatalogProvider } from "./catalog/types";

function cloneModel(model: Model<Api>): Model<Api> {
  return {
    ...model,
    input: [...model.input],
    cost: { ...model.cost, tiers: model.cost.tiers?.map((tier) => ({ ...tier })) },
    headers: model.headers ? { ...model.headers } : undefined,
    compat: model.compat ? structuredClone(model.compat) : undefined,
    thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
  };
}

export function adaptPiModel(model: Model<Api>, source: RegistryModel["source"]): RegistryModel {
  const cloned = cloneModel(model);
  return {
    id: cloned.id,
    providerId: String(cloned.provider),
    name: cloned.name || cloned.id,
    api: cloned.api,
    baseUrl: cloned.baseUrl,
    headers: cloned.headers ? { ...cloned.headers } : undefined,
    source,
    capabilities: {
      reasoning: Boolean(cloned.reasoning),
      thinkingLevels: supportedThinkingLevels(cloned),
      images: cloned.input.includes("image"),
      contextWindow: cloned.contextWindow,
      maxOutputTokens: cloned.maxTokens,
      compatibility: cloned.compat ? structuredClone(cloned.compat) : undefined,
    },
    availability: "missing-authentication",
    available: false,
    diagnostics: [],
    runtimeModel: cloned,
  };
}

function adaptCatalogModel(model: NormalizedCatalogModel): RegistryModel {
  const runtimeModel: Model<Api> = {
    id: model.modelId,
    name: model.name,
    api: model.api,
    provider: model.providerId,
    baseUrl: model.baseUrl ?? "",
    reasoning: model.reasoning,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: model.compat as never,
  };
  const adapted = adaptPiModel(runtimeModel, model.source === "embedded" ? "pi-builtin" : "models-dev");
  adapted.diagnostics = model.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  return adapted;
}

function mergeNormalizedProviders(providers: RegistryProvider[], additions: NormalizedCatalogProvider[]) {
  for (const addition of additions) {
    const existing = providers.find((provider) => provider.id === addition.id);
    if (!existing) {
      providers.push({
        id: addition.id,
        name: addition.name,
        baseUrl: addition.baseUrl,
        source: "models-dev",
        availability: "missing-authentication",
        diagnostics: [],
        hasAuthentication: false,
        hasPlaintextSecret: false,
        authMethods: [{ type: "api_key", label: "API key" }],
        configuredAuthTypes: [],
        models: addition.models.map(adaptCatalogModel),
      });
      continue;
    }
    if (addition.baseUrl && !existing.baseUrl) existing.baseUrl = addition.baseUrl;
    existing.name = existing.name || addition.name;
    for (const model of addition.models) {
      const adapted = adaptCatalogModel(model);
      const index = existing.models.findIndex((item) => item.id === adapted.id);
      if (index >= 0) existing.models.splice(index, 1, adapted);
      else existing.models.push(adapted);
    }
  }
}

export async function loadBuiltinModelCatalog(options: { homeDir?: string } = {}): Promise<BuiltinCatalog> {
  const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
  const providers: RegistryProvider[] = builtinProviders().map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    baseUrl: provider.baseUrl,
    source: "pi-builtin",
    availability: "missing-authentication",
    diagnostics: [],
    hasAuthentication: false,
    hasPlaintextSecret: false,
    authMethods: [
      ...(provider.auth.apiKey ? [{ type: "api_key" as const, label: provider.auth.apiKey.name }] : []),
      ...(provider.auth.oauth ? [{ type: "oauth" as const, label: provider.auth.oauth.name, isSubscription: provider.auth.oauth.isSubscription, loginLabel: provider.auth.oauth.loginLabel }] : []),
    ],
    configuredAuthTypes: [],
    models: provider.getModels().map((model) => adaptPiModel(model, "pi-builtin")),
  }));
  mergeNormalizedProviders(providers, embeddedCatalogProviders());
  if (options.homeDir) {
    const cached = readCatalogCache(modelsDevCatalogCachePath(options.homeDir));
    if (cached.snapshot) mergeNormalizedProviders(providers, cached.snapshot.providers);
  }
  return { providers };
}
