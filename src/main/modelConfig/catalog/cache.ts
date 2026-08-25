import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CatalogDiagnostic, CatalogSnapshot } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is CatalogSnapshot {
  if (!isObject(value)) return false;
  return value.schemaVersion === 1 && value.source === "models.dev" && typeof value.fetchedAt === "string" && Array.isArray(value.providers);
}

export interface CatalogCacheReadResult {
  snapshot?: CatalogSnapshot;
  diagnostic?: CatalogDiagnostic;
}

export function readCatalogCache(filePath: string): CatalogCacheReadResult {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isSnapshot(parsed)) {
      return { diagnostic: { code: "invalid-catalog-cache", message: "The cached Models.dev catalog is invalid or unsupported." } };
    }
    return { snapshot: parsed };
  } catch (error) {
    return {
      diagnostic: {
        code: "invalid-catalog-cache",
        message: error instanceof Error ? error.message : "Unable to read the cached Models.dev catalog.",
      },
    };
  }
}

export function writeCatalogCache(filePath: string, snapshot: CatalogSnapshot) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}
