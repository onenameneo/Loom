import type { ModelRegistryPayload } from "../env";

export type RendererProvider = ModelRegistryPayload["providers"][number];
export type RendererModel = RendererProvider["models"][number];

/** Legacy `builtin` is treated as catalog-owned for old settings snapshots. */
export function isCatalogSource(source: string): boolean {
  return source === "pi-builtin" || source === "models-dev" || source === "builtin";
}

export function catalogProviders(providers: RendererProvider[]): RendererProvider[] {
  return providers;
}

export function configuredProviders(providers: RendererProvider[]): RendererProvider[] {
  return providers
    .map((provider) => ({ ...provider, models: provider.models.filter((model) => !isCatalogSource(model.source)) }))
    .filter((provider) => provider.models.length > 0);
}

export function availableConfiguredModels(providers: RendererProvider[]): RendererModel[] {
  return configuredProviders(providers).flatMap((provider) => provider.models.filter((model) => model.available));
}
