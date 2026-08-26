import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { globalSettingsPath, loomAgentDir, modelsJsonPath } from "./paths";
import type { ModelDiagnostic } from "./types";
import type { ModelRef } from "./types";

export interface EnsureLoomAgentDefaultsOptions {
  homeDir?: string;
  legacyApiKeyPresent?: boolean;
}

export interface AddProviderModelConfigInput {
  providerId: string;
  providerName?: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  modelName?: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
  modelFromProvider?: boolean;
}

export function ensureLoomAgentDefaults(options: EnsureLoomAgentDefaultsOptions = {}) {
  const homeDir = options.homeDir ?? homedir();
  const dir = loomAgentDir(homeDir);
  const settingsPath = globalSettingsPath(homeDir);
  const diagnostics: ModelDiagnostic[] = [];

  mkdirSync(dir, { recursive: true });
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          defaults: {
            model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  if (options.legacyApiKeyPresent) {
    diagnostics.push({
      code: "legacy-key-not-migrated",
      message: "A legacy application-store API key exists. Move credentials to ~/.loom/agent/models.json.",
    });
  }

  return { dir, settingsPath, diagnostics };
}

function readSettingsObject(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export function writeGlobalDefaultModel(homeDir: string, model: ModelRef) {
  ensureLoomAgentDefaults({ homeDir });
  const settingsPath = globalSettingsPath(homeDir);
  const current = readSettingsObject(settingsPath);
  const defaults =
    current.defaults && typeof current.defaults === "object" && !Array.isArray(current.defaults)
      ? { ...(current.defaults as Record<string, unknown>) }
      : {};
  defaults.model = model;
  current.defaults = defaults;
  writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
}

export function addProviderModelConfig(homeDir: string, input: AddProviderModelConfigInput) {
  ensureLoomAgentDefaults({ homeDir });
  const filePath = modelsJsonPath(homeDir);
  const current = readJsonObject(filePath);
  const providers = objectValue(current.providers);
  const provider = objectValue(providers[input.providerId]);
  const models = objectValue(provider.models);

  if (input.providerName?.trim()) provider.name = input.providerName.trim();
  provider.baseUrl = input.baseUrl.trim();
  if (input.apiKey?.trim()) provider.apiKey = input.apiKey.trim();
  if (input.modelFromProvider) {
    const modelOverrides = objectValue(provider.modelOverrides);
    modelOverrides[input.modelId.trim()] = {};
    provider.modelOverrides = modelOverrides;
  } else {
    models[input.modelId.trim()] = {
      name: input.modelName?.trim() || input.modelId.trim(),
      api: input.api.trim(),
      reasoning: input.reasoning,
      input: input.images ? ["text", "image"] : ["text"],
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
    };
  }
  provider.models = models;
  providers[input.providerId.trim()] = provider;
  current.providers = providers;

  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
}

export function deleteProviderModelConfig(homeDir: string, input: ModelRef) {
  ensureLoomAgentDefaults({ homeDir });
  const filePath = modelsJsonPath(homeDir);
  const current = readJsonObject(filePath);
  const providers = objectValue(current.providers);
  const provider = objectValue(providers[input.providerId]);
  const models = objectValue(provider.models);
  const modelOverrides = objectValue(provider.modelOverrides);

  delete models[input.modelId];
  delete modelOverrides[input.modelId];
  provider.models = models;
  provider.modelOverrides = modelOverrides;
  providers[input.providerId] = provider;
  current.providers = providers;

  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
}

export function deleteProviderConfig(homeDir: string, providerId: string) {
  ensureLoomAgentDefaults({ homeDir });
  const filePath = modelsJsonPath(homeDir);
  const current = readJsonObject(filePath);
  const providers = objectValue(current.providers);

  delete providers[providerId.trim()];
  current.providers = providers;
  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
}
