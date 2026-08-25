import { describe, expect, it } from "vitest";
import { availableConfiguredModels, configuredProviders, isCatalogSource, type RendererProvider } from "./modelCatalogState";

const provider: RendererProvider = {
  id: "openai",
  name: "OpenAI",
  source: "models-dev",
  availability: "available",
  diagnostics: [],
  hasAuthentication: false,
  hasPlaintextSecret: false,
  models: [
    {
      id: "gpt-5.2",
      providerId: "openai",
      name: "GPT 5.2",
      api: "openai-completions" as const,
      source: "models-dev" as const,
      availability: "available" as const,
      available: true,
      diagnostics: [],
      capabilities: { reasoning: true, images: false, contextWindow: 128000, maxOutputTokens: 16000 },
    },
    {
      id: "custom",
      providerId: "openai",
      name: "Custom",
      api: "openai-completions" as const,
      source: "user-custom" as const,
      availability: "available" as const,
      available: true,
      diagnostics: [],
      capabilities: { reasoning: false, images: false, contextWindow: 32000, maxOutputTokens: 4000 },
    },
  ],
};

describe("model catalog state helpers", () => {
  it("recognizes catalog-owned sources, including the legacy source", () => {
    expect(isCatalogSource("models-dev")).toBe(true);
    expect(isCatalogSource("pi-builtin")).toBe(true);
    expect(isCatalogSource("builtin")).toBe(true);
    expect(isCatalogSource("user-custom")).toBe(false);
  });

  it("keeps catalog models available for selection but excludes them from configured models", () => {
    expect(configuredProviders([provider])).toHaveLength(1);
    expect(configuredProviders([provider])[0]?.models.map((model) => model.id)).toEqual(["custom"]);
    expect(availableConfiguredModels([provider]).map((model) => model.id)).toEqual(["custom"]);
  });
});
