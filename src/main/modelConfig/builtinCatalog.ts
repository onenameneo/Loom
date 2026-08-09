import type { Api, Model } from "@earendil-works/pi-ai";
import type { BuiltinCatalog, RegistryModel, RegistryProvider } from "./types";
import { supportedThinkingLevels } from "./thinkingLevels";

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

export async function loadBuiltinModelCatalog(): Promise<BuiltinCatalog> {
  const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
  const providers: RegistryProvider[] = builtinProviders().map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    baseUrl: provider.baseUrl,
    source: "builtin",
    availability: "missing-authentication",
    diagnostics: [],
    hasAuthentication: false,
    hasPlaintextSecret: false,
    models: provider.getModels().map((model) => adaptPiModel(model, "builtin")),
  }));
  return { providers };
}
