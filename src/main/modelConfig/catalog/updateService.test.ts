import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCatalogCache } from "./cache";
import { modelsDevFixture } from "./fixtures/catalog";
import { refreshModelsDevCatalog } from "./updateService";
import type { CatalogSnapshot } from "./types";

const tempDirs: string[] = [];

function oldSnapshot(): CatalogSnapshot {
  return { schemaVersion: 1, source: "models.dev", fetchedAt: "2020-01-01T00:00:00.000Z", providers: [] };
}

describe("Models.dev catalog update service", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("writes a valid refreshed snapshot and leaves models.json untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-update-"));
    tempDirs.push(home);
    const modelsPath = join(home, ".loom", "agent", "models.json");
    mkdirSync(join(home, ".loom", "agent"), { recursive: true });
    writeFileSync(modelsPath, '{"providers":{"openai":{"apiKey":"secret"}}}', { encoding: "utf8", flag: "w" });
    const result = await refreshModelsDevCatalog({ homeDir: home, force: true, client: { fetch: vi.fn(async () => new Response(JSON.stringify(modelsDevFixture), { status: 200, headers: { etag: "new" } })) } });
    expect(result.status).toBe("updated");
    expect(result.modelCount).toBeGreaterThan(0);
    expect(existsSync(join(home, ".loom", "agent", "catalog", "models-dev.json"))).toBe(true);
    expect(readFileSync(modelsPath, "utf8")).toContain("secret");
  });

  it("retains the previous snapshot on 304 or refresh failure", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-update-"));
    tempDirs.push(home);
    const cachePath = join(home, ".loom", "agent", "catalog", "models-dev.json");
    writeCatalogCache(cachePath, oldSnapshot());
    const notModified = await refreshModelsDevCatalog({ homeDir: home, force: true, client: { fetch: vi.fn(async () => new Response(null, { status: 304 })) } });
    expect(notModified.status).toBe("not-modified");
    const failed = await refreshModelsDevCatalog({ homeDir: home, force: true, client: { fetch: vi.fn(async () => new Response("bad", { status: 503 })) } });
    expect(failed.status).toBe("offline-fallback");
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toMatchObject({ fetchedAt: oldSnapshot().fetchedAt });
  });

  it("does not call the network for a fresh cache unless forced", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-catalog-update-"));
    tempDirs.push(home);
    const fresh = { ...oldSnapshot(), fetchedAt: new Date().toISOString() };
    writeCatalogCache(join(home, ".loom", "agent", "catalog", "models-dev.json"), fresh);
    const fetch = vi.fn();
    const result = await refreshModelsDevCatalog({ homeDir: home, client: { fetch } });
    expect(result.status).toBe("not-modified");
    expect(fetch).not.toHaveBeenCalled();
  });
});
