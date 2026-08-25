import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCatalogCache, writeCatalogCache } from "./cache";
import type { CatalogSnapshot } from "./types";

const tempDirs: string[] = [];

function snapshot(): CatalogSnapshot {
  return {
    schemaVersion: 1,
    source: "models.dev",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    etag: "etag-1",
    providers: [{ id: "openai", name: "OpenAI", models: [] }],
  };
}

describe("Models.dev catalog cache", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("returns empty for a missing cache", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-cache-"));
    tempDirs.push(home);
    expect(readCatalogCache(join(home, "catalog", "models-dev.json"))).toEqual({});
  });

  it("writes and reads a valid snapshot", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-cache-"));
    tempDirs.push(home);
    const filePath = join(home, "catalog", "models-dev.json");
    writeCatalogCache(filePath, snapshot());
    expect(existsSync(filePath)).toBe(true);
    expect(readCatalogCache(filePath).snapshot).toEqual(snapshot());
    expect(readFileSync(filePath, "utf8")).toContain('"schemaVersion": 1');
  });

  it("rejects malformed and unsupported cache data", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-cache-"));
    tempDirs.push(home);
    const filePath = join(home, "catalog", "models-dev.json");
    writeCatalogCache(filePath, snapshot());
    const malformed = join(home, "catalog", "malformed.json");
    const unsupported = join(home, "catalog", "unsupported.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(malformed, "{");
    writeFileSync(unsupported, JSON.stringify({ ...snapshot(), schemaVersion: 99 }));
    expect(readCatalogCache(malformed).diagnostic?.code).toBe("invalid-catalog-cache");
    expect(readCatalogCache(unsupported).diagnostic?.code).toBe("invalid-catalog-cache");
    expect(readCatalogCache(filePath).snapshot).toEqual(snapshot());
  });
});
