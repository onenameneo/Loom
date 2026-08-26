import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Api, Model } from "@earendil-works/pi-ai";
import { adaptPiModel, loadBuiltinModelCatalog } from "./builtinCatalog";
import { resolveConfigValue } from "./interpolation";
import { modelsJsonPath } from "./paths";
import { createJsonCredentialStore } from "./credentialStore";
import type {
  ConfigSource,
  ModelAvailability,
  ModelDiagnostic,
  ModelRef,
  ProviderSecret,
  RegistryModel,
  RegistryProvider,
  RendererRegistryDTO,
} from "./types";

type JsonObject = Record<string, unknown>;

export interface ModelRegistryOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

interface ProviderPatch {
  id: string;
  raw: JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectEntries(value: unknown): Array<[string, JsonObject]> {
  if (!isObject(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, JsonObject] => isObject(entry[1]));
}

function readJsonFile(filePath: string): { value?: JsonObject; diagnostics: ModelDiagnostic[] } {
  if (!existsSync(filePath)) return { diagnostics: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!isObject(parsed)) {
      return { diagnostics: [{ code: "invalid-models-json", message: "models.json must contain an object." }] };
    }
    return { value: parsed, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        {
          code: "invalid-models-json",
          message: error instanceof Error ? error.message : "Unable to parse models.json.",
        },
      ],
    };
  }
}

function sourceFor(existing: RegistryProvider | undefined): ConfigSource {
  return existing ? "user-overridden" : "user-custom";
}

function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}

function numberField(value: JsonObject, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function booleanField(value: JsonObject, key: string): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function stringArrayField(value: JsonObject, key: string): ("text" | "image")[] | undefined {
  const field = value[key];
  if (!Array.isArray(field)) return undefined;
  const items = field.filter((item): item is "text" | "image" => item === "text" || item === "image");
  return items.length ? items : undefined;
}

function thinkingLevelMapField(value: JsonObject, key: string): Model<Api>["thinkingLevelMap"] | undefined {
  const field = value[key];
  if (!isObject(field)) return undefined;
  const map: Record<string, string | null> = {};
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    const mapped = field[level];
    if (typeof mapped === "string" || mapped === null) map[level] = mapped;
  }
  return Object.keys(map).length ? map as Model<Api>["thinkingLevelMap"] : undefined;
}

function toRuntimeModel(provider: RegistryProvider, id: string, raw: JsonObject, base?: RegistryModel): Model<Api> {
  const api = stringField(raw, "api") ?? base?.api ?? ("" as Api);
  const contextWindow = numberField(raw, "contextWindow") ?? numberField(raw, "context") ?? base?.capabilities.contextWindow ?? 0;
  const maxTokens = numberField(raw, "maxTokens") ?? numberField(raw, "maxOutput") ?? base?.capabilities.maxOutputTokens ?? 0;
  const input = stringArrayField(raw, "input") ?? base?.runtimeModel.input ?? ["text"];
  return {
    ...(base?.runtimeModel ?? {
      id,
      name: id,
      api,
      provider: provider.id,
      baseUrl: provider.baseUrl || "",
      reasoning: false,
      input,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    }),
    id,
    provider: provider.id,
    name: stringField(raw, "name") ?? base?.name ?? id,
    api: api as Api,
    baseUrl: provider.baseUrl || base?.baseUrl || "",
    reasoning: booleanField(raw, "reasoning") ?? base?.capabilities.reasoning ?? false,
    thinkingLevelMap: {
      ...base?.runtimeModel.thinkingLevelMap,
      ...thinkingLevelMapField(raw, "thinkingLevelMap"),
    },
    input,
    contextWindow,
    maxTokens,
    headers: base?.headers,
    compat: raw.compat && typeof raw.compat === "object" ? structuredClone(raw.compat) : base?.runtimeModel.compat,
  };
}

function validateModel(provider: RegistryProvider, model: RegistryModel, custom: boolean): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  if (!provider.baseUrl && custom) diagnostics.push({ code: "invalid-provider", field: "baseUrl", message: "Custom provider requires baseUrl." });
  if (model.api === "unsupported") diagnostics.push({ code: "unsupported-api", field: `models.${model.id}.api`, message: "This model has no supported pi-ai API mapping." });
  if (!model.api) diagnostics.push({ code: "invalid-model", field: `models.${model.id}.api`, message: "Custom model requires api." });
  if (!model.capabilities.contextWindow) {
    diagnostics.push({ code: "invalid-model", field: `models.${model.id}.contextWindow`, message: "Model requires contextWindow." });
  }
  if (!model.capabilities.maxOutputTokens) {
    diagnostics.push({ code: "invalid-model", field: `models.${model.id}.maxTokens`, message: "Model requires maxTokens." });
  }
  return diagnostics;
}

function isConfigurationDiagnostic(diagnostic: ModelDiagnostic) {
  return diagnostic.code !== "missing-env";
}

function worstAvailability(providerDiagnostics: ModelDiagnostic[], hasAuthentication: boolean): ModelAvailability {
  if (providerDiagnostics.some(isConfigurationDiagnostic)) return "configuration-error";
  return hasAuthentication ? "available" : "missing-authentication";
}

export class ModelRegistry {
  private constructor(
    private readonly providers: RegistryProvider[],
    private readonly secrets: Map<string, ProviderSecret>,
    private readonly homeDir: string,
  ) {}

  static async load(options: ModelRegistryOptions = {}) {
    const homeDir = options.homeDir ?? homedir();
    const env = options.env ?? process.env;
    const catalog = await loadBuiltinModelCatalog({ homeDir });
    const providers = catalog.providers.map((provider) => ({
      ...provider,
      diagnostics: [...provider.diagnostics],
      authMethods: (provider.authMethods ?? []).map((method) => ({ ...method })),
      configuredAuthTypes: [...(provider.configuredAuthTypes ?? [])],
      models: provider.models.map((model) => ({ ...model, diagnostics: [...model.diagnostics] })),
    }));
    const secrets = new Map<string, ProviderSecret>();
    const storedAuthTypes = new Map((await createJsonCredentialStore(homeDir).list()).map((entry) => [entry.providerId, entry.type]));
    const file = readJsonFile(modelsJsonPath(homeDir));
    const providerPatches = objectEntries(file.value?.providers).map(([id, raw]): ProviderPatch => ({ id, raw }));

    for (const patch of providerPatches) {
      let provider = providers.find((item) => item.id === patch.id);
      const source = sourceFor(provider);
      if (!provider) {
        provider = {
          id: patch.id,
          name: stringField(patch.raw, "name") ?? patch.id,
          source,
          availability: "configuration-error",
          diagnostics: [],
          hasAuthentication: false,
          hasPlaintextSecret: false,
          authMethods: [{ type: "api_key", label: "API key" }],
          configuredAuthTypes: [],
          models: [],
        };
        providers.push(provider);
      }

      provider.source = source;
      provider.name = stringField(patch.raw, "name") ?? provider.name;
      provider.baseUrl = stringField(patch.raw, "baseUrl") ?? stringField(patch.raw, "baseURL") ?? provider.baseUrl;

      const apiKey = resolveConfigValue(patch.raw.apiKey, `providers.${patch.id}.apiKey`, env);
      const headerDiagnostics: ModelDiagnostic[] = [];
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(isObject(patch.raw.headers) ? patch.raw.headers : {})) {
        const resolved = resolveConfigValue(value, `providers.${patch.id}.headers.${key}`, env);
        if (resolved.value !== undefined) headers[key] = resolved.value;
        headerDiagnostics.push(...resolved.diagnostics);
        provider.hasPlaintextSecret ||= resolved.plaintext && /key|authorization|token|secret/i.test(key);
      }

      provider.diagnostics.push(...apiKey.diagnostics, ...headerDiagnostics);
      provider.hasPlaintextSecret ||= apiKey.plaintext;
      provider.configuredAuthTypes = [
        ...(apiKey.value ? ["api_key" as const] : []),
        ...(storedAuthTypes.get(patch.id) === "oauth" ? ["oauth" as const] : []),
      ];
      provider.hasAuthentication = provider.configuredAuthTypes.length > 0;
      secrets.set(patch.id, {
        apiKey: apiKey.value,
        headers: Object.keys(headers).length ? headers : undefined,
      });

      for (const model of provider.models) {
        model.baseUrl = provider.baseUrl || model.baseUrl;
        model.runtimeModel = { ...model.runtimeModel, baseUrl: model.baseUrl };
      }

      for (const [modelId, rawModel] of objectEntries(patch.raw.models)) {
        const existing = provider.models.find((model) => model.id === modelId);
        const runtimeModel = toRuntimeModel(provider, modelId, rawModel, existing);
        const model = adaptPiModel(runtimeModel, existing ? "user-overridden" : "user-custom");
        if (existing) provider.models.splice(provider.models.indexOf(existing), 1, model);
        else provider.models.push(model);
      }

      for (const [modelId, rawOverride] of objectEntries(patch.raw.modelOverrides)) {
        const existing = provider.models.find((model) => model.id === modelId);
        if (!existing) continue;
        const runtimeModel = toRuntimeModel(provider, modelId, rawOverride, existing);
        const model = adaptPiModel(runtimeModel, "user-overridden");
        provider.models.splice(provider.models.indexOf(existing), 1, model);
      }
    }

    for (const provider of providers) {
      const configuredAuthTypes = provider.configuredAuthTypes ?? (provider.configuredAuthTypes = []);
      if (storedAuthTypes.get(provider.id) === "oauth" && !configuredAuthTypes.includes("oauth")) {
        configuredAuthTypes.push("oauth");
        provider.hasAuthentication = true;
      }
      const providerCustom = provider.source === "user-custom";
      provider.availability = worstAvailability(provider.diagnostics, provider.hasAuthentication);
      for (const model of provider.models) {
        const diagnostics = [...provider.diagnostics, ...model.diagnostics, ...validateModel(provider, model, providerCustom)];
        model.diagnostics = diagnostics;
        model.availability = diagnostics.some(isConfigurationDiagnostic) ? "configuration-error" : provider.availability;
        model.available = model.availability === "available";
      }
    }

    return new ModelRegistry(providers, secrets, homeDir);
  }

  listProviders() {
    return this.providers;
  }

  getHomeDir() {
    return this.homeDir;
  }

  requireModel(ref: ModelRef) {
    const model = this.providers.find((provider) => provider.id === ref.providerId)?.models.find((item) => item.id === ref.modelId);
    if (!model) throw new Error(`Unknown model ${ref.providerId}/${ref.modelId}.`);
    return model;
  }

  requireProviderSecret(providerId: string): ProviderSecret {
    return this.secrets.get(providerId) ?? {};
  }

  toRendererDTO(): RendererRegistryDTO {
    return {
      providers: this.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        source: provider.source,
        availability: provider.availability,
        diagnostics: provider.diagnostics,
        hasAuthentication: provider.hasAuthentication,
        hasPlaintextSecret: provider.hasPlaintextSecret,
        authMethods: provider.authMethods ?? [{ type: "api_key", label: "API key" }],
        configuredAuthTypes: provider.configuredAuthTypes ?? [],
        models: provider.models.map((model) => ({
          id: model.id,
          providerId: model.providerId,
          name: model.name,
          api: String(model.api),
          source: model.source,
          availability: model.availability,
          available: model.available,
          diagnostics: model.diagnostics,
          capabilities: model.capabilities,
        })),
      })),
    };
  }
}
