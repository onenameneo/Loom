import type { ModelDiagnostic, ModelRef } from "./types";

export type StoredModelSelection = ModelRef | string;

export type ParsedModelSelection =
  | { kind: "ref"; ref: ModelRef }
  | { kind: "legacy"; legacyModel: string }
  | { kind: "empty" }
  | { kind: "invalid"; diagnostic: ModelDiagnostic };

export interface ModelRefRegistryLike {
  listProviders(): Array<{ id: string; models: Array<{ id: string }> }>;
}

export type MigratedModelSelection =
  | { kind: "ref"; ref: ModelRef }
  | { kind: "unresolved"; legacyModel: string; diagnostic: ModelDiagnostic };

function isModelRef(value: unknown): value is ModelRef {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).providerId === "string" &&
    typeof (value as Record<string, unknown>).modelId === "string"
  );
}

export function parseStoredModelRef(value: unknown): ParsedModelSelection {
  if (value === undefined || value === null || value === "") return { kind: "empty" };
  if (isModelRef(value)) return { kind: "ref", ref: { providerId: value.providerId, modelId: value.modelId } };
  if (typeof value === "string") return { kind: "legacy", legacyModel: value };
  return {
    kind: "invalid",
    diagnostic: { code: "invalid-model-ref", message: "Stored model selection must be provider-qualified." },
  };
}

export function migrateLegacyModelRef(value: string, registry: ModelRefRegistryLike): MigratedModelSelection {
  const matches = registry
    .listProviders()
    .flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, modelId: model.id })))
    .filter((ref) => ref.modelId === value);
  if (matches.length === 1) return { kind: "ref", ref: matches[0] };
  return {
    kind: "unresolved",
    legacyModel: value,
    diagnostic: {
      code: matches.length > 1 ? "ambiguous-legacy-model" : "unknown-legacy-model",
      message:
        matches.length > 1
          ? `Legacy model ${value} matches multiple providers.`
          : `Legacy model ${value} is not registered.`,
    },
  };
}
