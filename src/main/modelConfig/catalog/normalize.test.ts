import { describe, expect, it } from "vitest";
import { modelsDevFixture } from "./fixtures/catalog";
import { normalizeModelsDevCatalog } from "./normalize";

describe("Models.dev normalization", () => {
  it("maps provider-specific limits, cost, modalities, and reasoning", () => {
    const result = normalizeModelsDevCatalog(modelsDevFixture, "2026-08-25T00:00:00.000Z");
    const model = result.providers[0]?.models[0];
    expect(model).toMatchObject({
      providerId: "fixture-openai",
      modelId: "reasoner",
      api: "openai-completions",
      baseUrl: "https://fixture.example/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 16000,
      cost: { input: 1, output: 4, cacheRead: 0.2 },
    });
  });

  it("diagnoses missing limits and unsupported provider protocols", () => {
    const result = normalizeModelsDevCatalog(modelsDevFixture);
    const openai = result.providers.find((provider) => provider.id === "fixture-openai");
    const unknown = result.providers.find((provider) => provider.id === "fixture-unknown");
    expect(openai?.models.find((model) => model.modelId === "missing-limit")?.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["missing-context-window", "missing-max-tokens"]));
    expect(unknown?.models[0]?.diagnostics.map((item) => item.code)).toContain("unsupported-api");
  });
});
