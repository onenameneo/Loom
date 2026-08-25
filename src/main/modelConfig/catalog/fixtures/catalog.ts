export const modelsDevFixture = {
  models: {},
  providers: {
    "fixture-openai": {
      id: "fixture-openai",
      name: "Fixture OpenAI",
      npm: "@ai-sdk/openai-compatible",
      api: "https://fixture.example/v1",
      doc: "https://fixture.example/docs",
      models: {
        "fixture-openai/reasoner": {
          id: "fixture-openai/reasoner",
          name: "Fixture Reasoner",
          reasoning: true,
          tool_call: true,
          structured_output: true,
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 128000, output: 16000 },
          cost: { input: 1, output: 4, cache_read: 0.2 },
          last_updated: "2026-08-25",
        },
        "fixture-openai/missing-limit": {
          id: "fixture-openai/missing-limit",
          name: "Missing Limit",
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
    "fixture-unknown": {
      id: "fixture-unknown",
      name: "Unknown Fixture",
      npm: "@fixture/non-standard",
      api: "https://fixture.example/custom",
      models: {
        "fixture-model": { id: "fixture-model", name: "Unsupported", limit: { context: 4096, output: 1024 }, modalities: { input: ["text"] } },
      },
    },
  },
};
