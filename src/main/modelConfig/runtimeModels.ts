import type { Api, ProviderStreams } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "./registry";

async function apiStreams(api: Api): Promise<ProviderStreams> {
  const { lazyApi } = await import("@earendil-works/pi-ai");
  switch (api) {
    case "anthropic-messages":
      return lazyApi(() => import("@earendil-works/pi-ai/api/anthropic-messages"));
    case "openai-completions":
      return lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
    case "openai-responses":
      return lazyApi(() => import("@earendil-works/pi-ai/api/openai-responses"));
    case "openai-codex-responses":
      return lazyApi(() => import("@earendil-works/pi-ai/api/openai-codex-responses"));
    case "azure-openai-responses":
      return lazyApi(() => import("@earendil-works/pi-ai/api/azure-openai-responses"));
    case "google-generative-ai":
      return lazyApi(() => import("@earendil-works/pi-ai/api/google-generative-ai"));
    case "google-vertex":
      return lazyApi(() => import("@earendil-works/pi-ai/api/google-vertex"));
    case "mistral-conversations":
      return lazyApi(() => import("@earendil-works/pi-ai/api/mistral-conversations"));
    case "bedrock-converse-stream":
      return lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream"));
    case "pi-messages":
      return lazyApi(() => import("@earendil-works/pi-ai/api/pi-messages"));
    default:
      throw new Error(`Unsupported model api: ${api}`);
  }
}

export function isSupportedRuntimeApi(api: Api) {
  return [
    "anthropic-messages",
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "azure-openai-responses",
    "google-generative-ai",
    "google-vertex",
    "mistral-conversations",
    "bedrock-converse-stream",
    "pi-messages",
  ].includes(api);
}

export async function createRuntimeModelsFromRegistry(registry: ModelRegistry) {
  const { createModels, createProvider } = await import("@earendil-works/pi-ai");
  const models = createModels();
  models.clearProviders();

  for (const provider of registry.listProviders()) {
    const apiEntries = await Promise.all(
      [...new Set(provider.models.filter((model) => isSupportedRuntimeApi(model.api)).map((model) => model.api))].map(async (api) => [api, await apiStreams(api)] as const),
    );
    const apiMap = Object.fromEntries(apiEntries) as Partial<Record<Api, ProviderStreams>>;
    const secret = registry.requireProviderSecret(provider.id);
    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        headers: secret.headers,
        auth: {
          apiKey: {
            name: `${provider.name} API key`,
            check: async () => (secret.apiKey ? { type: "api_key", source: "models.json" } : undefined),
            resolve: async () => (secret.apiKey ? { auth: { apiKey: secret.apiKey, headers: secret.headers }, source: "models.json" } : undefined),
          },
        },
        models: provider.models.filter((model) => isSupportedRuntimeApi(model.api)).map((model) => model.runtimeModel),
        api: apiMap,
      }),
    );
  }

  return models;
}
