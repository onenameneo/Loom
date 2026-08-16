import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { globalSettingsPath } from "./paths";
import type { ModelDiagnostic, ModelRef, RegistryModel } from "./types";
import type { ModelRegistry } from "./registry";
import { migrateLegacyModelRef, parseStoredModelRef, type StoredModelSelection } from "./modelRef";

type JsonObject = Record<string, unknown>;

export interface ScopedSettingsOptions {
  homeDir?: string;
  projectRoot?: string;
}

export interface ScopedModelSettings {
  defaults?: {
    model?: ModelRef;
  };
  ui?: JsonObject;
}

export interface LoadedScopedModelSettings {
  settings: ScopedModelSettings;
  globalSettings: ScopedModelSettings;
  projectSettings: ScopedModelSettings;
  diagnostics: ModelDiagnostic[];
  sources: {
    global?: string;
    project?: string;
  };
}

export interface ResolvedSelection {
  ref: ModelRef;
  model?: RegistryModel;
  available: boolean;
  source: "explicit" | "project" | "global" | "fallback";
  diagnostic?: ModelDiagnostic;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath: string): { value?: JsonObject; diagnostic?: ModelDiagnostic } {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!isObject(parsed)) return { diagnostic: { code: "invalid-settings", message: `${filePath} must contain an object.` } };
    return { value: parsed };
  } catch (error) {
    return {
      diagnostic: {
        code: "invalid-settings",
        message: error instanceof Error ? error.message : `Unable to parse ${filePath}.`,
      },
    };
  }
}

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (!isObject(base) || !isObject(overlay)) return overlay ?? base;
  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) next[key] = deepMerge(next[key], value);
  return next;
}

function asModelRef(value: unknown): ModelRef | undefined {
  if (!isObject(value)) return undefined;
  const providerId = value.providerId;
  const modelId = value.modelId;
  return typeof providerId === "string" && typeof modelId === "string" ? { providerId, modelId } : undefined;
}

function sanitizeProjectSettings(value: JsonObject, diagnostics: ModelDiagnostic[]): JsonObject {
  const clone: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (/apiKey|authorization|token|secret|headers|providers/i.test(key)) {
      diagnostics.push({
        code: "project-credential-field",
        field: key,
        message: `Project settings cannot contain credential-bearing field ${key}; use ~/.loom/agent/models.json.`,
      });
      continue;
    }
    clone[key] = isObject(child) ? sanitizeProjectSettings(child, diagnostics) : child;
  }
  return clone;
}

function normalizeSettings(value: unknown): ScopedModelSettings {
  if (!isObject(value)) return {};
  return {
    defaults: {
      model: asModelRef(isObject(value.defaults) ? value.defaults.model : undefined),
    },
    ui: isObject(value.ui) ? value.ui : undefined,
  };
}

export function loadScopedModelSettings(options: ScopedSettingsOptions = {}): LoadedScopedModelSettings {
  const homeDir = options.homeDir ?? homedir();
  const diagnostics: ModelDiagnostic[] = [];
  const globalPath = globalSettingsPath(homeDir);
  const projectPath = options.projectRoot ? join(options.projectRoot, ".loom", "settings.json") : undefined;
  const global = readJson(globalPath);
  const project = projectPath ? readJson(projectPath) : {};

  if (global.diagnostic) diagnostics.push(global.diagnostic);
  if (project.diagnostic) diagnostics.push(project.diagnostic);

  const sanitizedProject = project.value ? sanitizeProjectSettings(project.value, diagnostics) : undefined;
  const merged = deepMerge(global.value ?? {}, sanitizedProject ?? {});

  return {
    settings: normalizeSettings(merged),
    globalSettings: normalizeSettings(global.value),
    projectSettings: normalizeSettings(sanitizedProject),
    diagnostics,
    sources: {
      global: global.value ? globalPath : undefined,
      project: project.value ? projectPath : undefined,
    },
  };
}

function firstAvailable(registry: ModelRegistry): RegistryModel | undefined {
  return registry.listProviders().flatMap((provider) => provider.models).find((model) => model.available);
}

function findModel(registry: ModelRegistry, ref: ModelRef): RegistryModel | undefined {
  return registry
    .listProviders()
    .find((provider) => provider.id === ref.providerId)
    ?.models.find((model) => model.id === ref.modelId);
}

export function resolveSelectedModel(input: {
  registry: ModelRegistry;
  scoped: LoadedScopedModelSettings;
  explicit?: ModelRef;
}): ResolvedSelection {
  const candidates: Array<{ ref?: ModelRef; source: ResolvedSelection["source"] }> = [
    { ref: input.explicit, source: "explicit" },
    { ref: input.scoped.projectSettings.defaults?.model, source: "project" },
    { ref: input.scoped.globalSettings.defaults?.model, source: "global" },
  ];

  for (const candidate of candidates) {
    if (!candidate.ref) continue;
    const model = findModel(input.registry, candidate.ref);
    if (!model) {
      return {
        ref: candidate.ref,
        available: false,
        source: candidate.source,
        diagnostic: { code: "unknown-model", message: `Unknown model ${candidate.ref.providerId}/${candidate.ref.modelId}.` },
      };
    }
    return {
      ref: candidate.ref,
      model,
      available: model.available,
      source: candidate.source,
      diagnostic: model.available ? undefined : model.diagnostics[0],
    };
  }

  const fallback = firstAvailable(input.registry);
  if (fallback) {
    return {
      ref: { providerId: fallback.providerId, modelId: fallback.id },
      model: fallback,
      available: true,
      source: "fallback",
    };
  }
  return {
    ref: { providerId: "", modelId: "" },
    available: false,
    source: "fallback",
    diagnostic: { code: "no-available-model", message: "No structurally available model is configured." },
  };
}

/** Resolve persisted node selections and legacy model IDs using the same precedence as the engine. */
export function resolveStoredModelSelection(input: {
  registry: ModelRegistry;
  scoped: LoadedScopedModelSettings;
  explicit?: StoredModelSelection;
}): ResolvedSelection {
  const parsed = parseStoredModelRef(input.explicit);
  if (parsed.kind === "invalid") {
    return {
      ref: { providerId: "", modelId: "" },
      available: false,
      source: "explicit",
      diagnostic: parsed.diagnostic,
    };
  }
  if (parsed.kind === "legacy") {
    const migrated = migrateLegacyModelRef(parsed.legacyModel, input.registry);
    if (migrated.kind === "unresolved") {
      return {
        ref: { providerId: "", modelId: migrated.legacyModel },
        available: false,
        source: "explicit",
        diagnostic: migrated.diagnostic,
      };
    }
    return resolveSelectedModel({ ...input, explicit: migrated.ref });
  }
  return resolveSelectedModel({
    registry: input.registry,
    scoped: input.scoped,
    explicit: parsed.kind === "ref" ? parsed.ref : undefined,
  });
}
