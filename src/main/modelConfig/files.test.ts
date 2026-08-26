import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addProviderModelConfig, deleteProviderConfig, deleteProviderModelConfig, ensureLoomAgentDefaults, writeGlobalDefaultModel } from "./files";

const tempDirs: string[] = [];

describe("model config files", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("creates ~/.loom/agent defaults without writing credentials", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);

    const result = ensureLoomAgentDefaults({ homeDir: home, legacyApiKeyPresent: true });
    const settingsText = readFileSync(join(home, ".loom", "agent", "settings.json"), "utf-8");

    expect(existsSync(join(home, ".loom", "agent"))).toBe(true);
    expect(settingsText).toContain("claude-sonnet-4-5");
    expect(settingsText).not.toMatch(/apiKey|secret|token|authorization/i);
    expect(existsSync(join(home, ".loom", "agent", "models.json"))).toBe(false);
    expect(result.diagnostics.some((diag) => diag.code === "legacy-key-not-migrated")).toBe(true);
  });

  it("updates the global default model without removing other settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);
    ensureLoomAgentDefaults({ homeDir: home });

    writeGlobalDefaultModel(home, { providerId: "local", modelId: "llama" });
    const settings = JSON.parse(readFileSync(join(home, ".loom", "agent", "settings.json"), "utf-8"));

    expect(settings.defaults.model).toEqual({ providerId: "local", modelId: "llama" });
  });

  it("adds a provider/model entry to models.json while preserving existing providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);

    addProviderModelConfig(home, {
      providerId: "local-openai",
      providerName: "Local OpenAI",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "$LOCAL_OPENAI_KEY",
      modelId: "llama-3.3",
      modelName: "Llama 3.3",
      api: "openai-completions",
      contextWindow: 131072,
      maxTokens: 8192,
      reasoning: false,
      images: false,
    });
    addProviderModelConfig(home, {
      providerId: "anthropic",
      baseUrl: "https://anthropic-proxy.example.com",
      apiKey: "$ANTHROPIC_API_KEY",
      modelId: "claude-sonnet-4-5",
      modelName: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      images: true,
    });

    const models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));

    expect(models.providers["local-openai"]).toMatchObject({
      name: "Local OpenAI",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "$LOCAL_OPENAI_KEY",
      models: {
        "llama-3.3": {
          name: "Llama 3.3",
          api: "openai-completions",
          contextWindow: 131072,
          maxTokens: 8192,
          input: ["text"],
        },
      },
    });
    expect(models.providers.anthropic.baseUrl).toBe("https://anthropic-proxy.example.com");
  });

  it("edits and deletes a configured provider model without removing provider credentials", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);

    addProviderModelConfig(home, {
      providerId: "openai",
      providerName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "$OPENAI_API_KEY",
      modelId: "gpt-5.2",
      modelName: "GPT 5.2",
      api: "openai-completions",
      contextWindow: 128000,
      maxTokens: 16000,
      reasoning: true,
      images: false,
    });
    addProviderModelConfig(home, {
      providerId: "openai",
      baseUrl: "https://proxy.openai.test/v1",
      modelId: "gpt-5.2",
      modelName: "GPT 5.2 Proxy",
      api: "openai-responses",
      contextWindow: 256000,
      maxTokens: 32000,
      reasoning: true,
      images: true,
    });

    let models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));
    expect(models.providers.openai.apiKey).toBe("$OPENAI_API_KEY");
    expect(models.providers.openai.baseUrl).toBe("https://proxy.openai.test/v1");
    expect(models.providers.openai.models["gpt-5.2"]).toMatchObject({
      name: "GPT 5.2 Proxy",
      api: "openai-responses",
      contextWindow: 256000,
      maxTokens: 32000,
      input: ["text", "image"],
    });

    deleteProviderModelConfig(home, { providerId: "openai", modelId: "gpt-5.2" });
    models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));
    expect(models.providers.openai.apiKey).toBe("$OPENAI_API_KEY");
    expect(models.providers.openai.models["gpt-5.2"]).toBeUndefined();
  });

  it("stores provider-owned models as lightweight overrides", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);

    addProviderModelConfig(home, {
      providerId: "anthropic",
      providerName: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "$ANTHROPIC_API_KEY",
      modelId: "claude-sonnet-4-5",
      modelName: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      images: true,
      modelFromProvider: true,
    });

    let models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));
    expect(models.providers.anthropic.models).toEqual({});
    expect(models.providers.anthropic.modelOverrides["claude-sonnet-4-5"]).toEqual({});

    deleteProviderModelConfig(home, { providerId: "anthropic", modelId: "claude-sonnet-4-5" });
    models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));
    expect(models.providers.anthropic.modelOverrides["claude-sonnet-4-5"]).toBeUndefined();
  });

  it("deletes an entire provider while preserving other providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);

    addProviderModelConfig(home, {
      providerId: "openai",
      providerName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-5.2",
      modelName: "GPT 5.2",
      api: "openai-responses",
      contextWindow: 128000,
      maxTokens: 16000,
      reasoning: true,
      images: true,
    });
    addProviderModelConfig(home, {
      providerId: "anthropic",
      providerName: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      modelId: "claude-sonnet-4-5",
      modelName: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      images: true,
    });

    deleteProviderConfig(home, "openai");
    const models = JSON.parse(readFileSync(join(home, ".loom", "agent", "models.json"), "utf-8"));

    expect(models.providers.openai).toBeUndefined();
    expect(models.providers.anthropic).toBeDefined();
  });
});
