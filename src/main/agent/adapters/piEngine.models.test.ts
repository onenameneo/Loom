import { describe, expect, it } from "vitest";
import { modelsForSwitching } from "./piEngine";
import type { RegistryProvider } from "../../modelConfig/types";

function provider(models: Array<{ id: string; source: "builtin" | "user-custom" | "user-overridden"; available: boolean }>): RegistryProvider {
  return {
    id: "openai",
    name: "OpenAI",
    source: "builtin",
    availability: "available",
    diagnostics: [],
    hasAuthentication: true,
    hasPlaintextSecret: false,
    models: models.map((model) => ({
      id: model.id,
      providerId: "openai",
      name: model.id,
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      source: model.source,
      availability: model.available ? "available" : "missing-authentication",
      available: model.available,
      diagnostics: [],
      capabilities: { reasoning: false, images: false, contextWindow: 128000, maxOutputTokens: 8192 },
      runtimeModel: {} as never,
    })),
  };
}

describe("pi engine model switch list", () => {
  it("returns only user-configured available models for /model switching", () => {
    const models = modelsForSwitching([
      provider([
        { id: "builtin-gpt", source: "builtin", available: true },
        { id: "custom-gpt", source: "user-custom", available: true },
        { id: "overridden-gpt", source: "user-overridden", available: true },
        { id: "broken-gpt", source: "user-custom", available: false },
      ]),
    ]);

    expect(models.map((model) => model.id)).toEqual(["openai/custom-gpt", "openai/overridden-gpt"]);
  });
});
