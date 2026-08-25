import type { NormalizedCatalogProvider } from "./types";

/**
 * Product-curated offline additions belong here. pi-ai's own builtins are
 * already loaded separately, so this starts empty until Loom verifies a
 * provider/model that should ship independently of Models.dev.
 */
export function embeddedCatalogProviders(): NormalizedCatalogProvider[] {
  return [];
}
