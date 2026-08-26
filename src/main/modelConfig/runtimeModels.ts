import type { Api, ProviderAuth, ProviderStreams } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "./registry";
import { createJsonCredentialStore } from "./credentialStore";

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
  const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
  const { createModels, createProvider } = await import("@earendil-works/pi-ai");
  const builtinAuth = new Map(builtinProviders().map((provider) => [provider.id, provider.auth]));
  const models = createModels({ credentials: createJsonCredentialStore(registry.getHomeDir()) });
  models.clearProviders();

  for (const provider of registry.listProviders()) {
    const apiEntries = await Promise.all(
      [...new Set(provider.models.filter((model) => isSupportedRuntimeApi(model.api)).map((model) => model.api))].map(async (api) => [api, await apiStreams(api)] as const),
    );
    const apiMap = Object.fromEntries(apiEntries) as Partial<Record<Api, ProviderStreams>>;
    const secret = registry.requireProviderSecret(provider.id);
    const explicitApiKey = secret.apiKey
      ? {
          name: `${provider.name} API key`,
          check: async () => ({ type: "api_key" as const, source: "models.json" }),
          resolve: async () => ({ auth: { apiKey: secret.apiKey, headers: secret.headers }, source: "models.json" }),
        }
      : undefined;
    const auth: ProviderAuth = {
      ...builtinAuth.get(provider.id),
      ...(explicitApiKey ? { apiKey: explicitApiKey } : {}),
    };
    if (!auth.apiKey && !auth.oauth) {
      auth.apiKey = {
        name: `${provider.name} API key`,
        check: async () => undefined,
        resolve: async () => undefined,
      };
    }
    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        headers: secret.headers,
        auth,
        models: provider.models.filter((model) => isSupportedRuntimeApi(model.api)).map((model) => model.runtimeModel),
        api: apiMap,
      }),
    );
  }

  return models;
}
