import type { Api } from "@earendil-works/pi-ai";

export type CatalogSource = "models-dev" | "embedded";

export interface CatalogDiagnostic {
  code: string;
  message: string;
  field?: string;
}

export interface NormalizedCatalogModel {
  providerId: string;
  modelId: string;
  name: string;
  api: Api;
  baseUrl?: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  compat?: Record<string, unknown>;
  source: CatalogSource;
  sourceUrl?: string;
  lastVerifiedAt?: string;
  diagnostics: CatalogDiagnostic[];
}

export interface NormalizedCatalogProvider {
  id: string;
  name: string;
  baseUrl?: string;
  api?: Api;
  models: NormalizedCatalogModel[];
}

export interface CatalogSnapshot {
  schemaVersion: 1;
  source: "models.dev";
  fetchedAt: string;
  etag?: string;
  providers: NormalizedCatalogProvider[];
}

export type CatalogUpdateStatus = "updated" | "not-modified" | "offline-fallback" | "invalid-response" | "failed";

export interface CatalogUpdateResult {
  status: CatalogUpdateStatus;
  fetchedAt?: string;
  providerCount: number;
  modelCount: number;
  diagnostics: CatalogDiagnostic[];
}
