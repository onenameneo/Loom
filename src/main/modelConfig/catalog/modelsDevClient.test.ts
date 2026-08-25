import { describe, expect, it, vi } from "vitest";
import { fetchModelsDevCatalog } from "./modelsDevClient";
import { modelsDevFixture } from "./fixtures/catalog";

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...init.headers }, ...init });
}

describe("Models.dev client", () => {
  it("normalizes a valid provider catalog", async () => {
    const result = await fetchModelsDevCatalog({ fetch: vi.fn(async () => response(modelsDevFixture)) });
    expect(result.snapshot?.providers).toHaveLength(2);
    expect(result.snapshot?.providers[0]?.models[0]).toMatchObject({ providerId: "fixture-openai", modelId: "reasoner", api: "openai-completions" });
  });

  it("uses conditional requests and accepts not-modified", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe("etag-1");
      return new Response(null, { status: 304 });
    });
    const result = await fetchModelsDevCatalog({ fetch }, { schemaVersion: 1, source: "models.dev", fetchedAt: "now", etag: "etag-1", providers: [] });
    expect(result.notModified).toBe(true);
  });

  it("returns safe diagnostics for HTTP, timeout, oversized, and invalid responses", async () => {
    const http = await fetchModelsDevCatalog({ fetch: vi.fn(async () => new Response("no", { status: 503 })) });
    expect(http.diagnostics[0]?.code).toBe("catalog-http");
    const invalid = await fetchModelsDevCatalog({ fetch: vi.fn(async () => response({ providers: {} })) });
    expect(invalid.diagnostics.some((item) => item.code === "empty-catalog")).toBe(true);
    const oversized = await fetchModelsDevCatalog({ maxBytes: 3, fetch: vi.fn(async () => response(modelsDevFixture)) });
    expect(oversized.diagnostics[0]?.code).toBe("catalog-fetch");
    const timeout = await fetchModelsDevCatalog({ timeoutMs: 0, fetch: vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) });
    expect(timeout.diagnostics[0]?.code).toBe("catalog-timeout");
  });
});
