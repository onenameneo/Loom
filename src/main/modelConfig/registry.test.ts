import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBuiltinModelCatalog } from "./builtinCatalog";
import { ModelRegistry } from "./registry";

const tempDirs: string[] = [];

async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), "loom-models-"));
  tempDirs.push(dir);
  return dir;
}

function writeModelsJson(home: string, value: unknown) {
  const dir = join(home, ".loom", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "models.json"), JSON.stringify(value, null, 2));
}

describe("model registry", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    delete process.env.LOOM_PROVIDER_KEY;
  });

  it("adapts Pi built-in providers and model capabilities without a Loom-owned catalog", async () => {
    const catalog = await loadBuiltinModelCatalog();

    const anthropic = catalog.providers.find((provider) => provider.id === "anthropic");
    const sonnet = anthropic?.models.find((model) => model.id === "claude-sonnet-4-5");

    expect(anthropic?.source).toBe("builtin");
    expect(sonnet).toMatchObject({
      providerId: "anthropic",
      id: "claude-sonnet-4-5",
      api: "anthropic-messages",
      capabilities: {
        reasoning: true,
        images: true,
      },
    });
    expect(sonnet?.capabilities.contextWindow).toBeGreaterThan(0);
    expect(sonnet?.capabilities.maxOutputTokens).toBeGreaterThan(0);
  });

  it("overlays built-in providers, upserts models, and applies model overrides", async () => {
    const home = await tempHome();
    writeModelsJson(home, {
      providers: {
        anthropic: {
          baseUrl: "https://anthropic-proxy.test",
          apiKey: "$LOOM_PROVIDER_KEY",
          models: {
            "local-sonnet": {
              name: "Local Sonnet",
              api: "anthropic-messages",
              contextWindow: 1234,
              maxTokens: 567,
              reasoning: true,
              thinkingLevelMap: { minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
              input: ["text"],
            },
          },
          modelOverrides: {
            "claude-sonnet-4-5": {
              name: "Proxy Sonnet",
              maxTokens: 2048,
              thinkingLevelMap: { xhigh: "xhigh", max: null },
            },
          },
        },
      },
    });
    process.env.LOOM_PROVIDER_KEY = "secret";

    const registry = await ModelRegistry.load({ homeDir: home });
    const builtin = registry.requireModel({ providerId: "anthropic", modelId: "claude-sonnet-4-5" });
    const custom = registry.requireModel({ providerId: "anthropic", modelId: "local-sonnet" });

    expect(builtin.baseUrl).toBe("https://anthropic-proxy.test");
    expect(builtin.name).toBe("Proxy Sonnet");
    expect(builtin.capabilities.maxOutputTokens).toBe(2048);
    expect(builtin.capabilities.thinkingLevels).toEqual(expect.arrayContaining(["off", "minimal", "low", "medium", "high", "xhigh"]));
    expect(builtin.capabilities.thinkingLevels).not.toContain("max");
    expect(builtin.source).toBe("user-overridden");
    expect(custom.source).toBe("user-custom");
    expect(custom.capabilities.thinkingLevels).toEqual(["off", "low", "medium", "high", "xhigh"]);
    expect(custom.available).toBe(true);
  });

  it("resolves literal and environment-interpolated secrets while redacting renderer DTOs", async () => {
    const home = await tempHome();
    writeModelsJson(home, {
      providers: {
        anthropic: {
          apiKey: "literal-$LOOM_PROVIDER_KEY-${LOOM_PROVIDER_KEY}-$$-$!",
          headers: {
            "x-api-key": "$LOOM_PROVIDER_KEY",
            "x-label": "not-secret",
          },
        },
      },
    });
    process.env.LOOM_PROVIDER_KEY = "resolved";

    const registry = await ModelRegistry.load({ homeDir: home });
    const resolved = registry.requireProviderSecret("anthropic");
    const dto = registry.toRendererDTO();

    expect(resolved.apiKey).toBe("literal-resolved-resolved-$-!");
    expect(resolved.headers).toMatchObject({ "x-api-key": "resolved", "x-label": "not-secret" });
    expect(JSON.stringify(dto)).not.toContain("resolved");
    expect(JSON.stringify(dto)).not.toContain("literal");
    expect(dto.providers.find((provider) => provider.id === "anthropic")?.hasPlaintextSecret).toBe(true);
  });

  it("marks missing environment keys and command values unavailable without execution", async () => {
    const home = await tempHome();
    writeModelsJson(home, {
      providers: {
        anthropic: { apiKey: "$MISSING_LOOM_KEY" },
        openai: { apiKey: "!security find-generic-password -w" },
      },
    });

    const registry = await ModelRegistry.load({ homeDir: home });
    const anthropic = registry.requireModel({ providerId: "anthropic", modelId: "claude-sonnet-4-5" });
    const openai = registry.toRendererDTO().providers.find((provider) => provider.id === "openai");

    expect(anthropic.availability).toBe("missing-authentication");
    expect(openai?.availability).toBe("configuration-error");
    expect(openai?.diagnostics.some((diag) => diag.code === "unsupported-command")).toBe(true);
  });

  it("reports invalid custom provider definitions as configuration errors", async () => {
    const home = await tempHome();
    writeModelsJson(home, {
      providers: {
        local: {
          apiKey: "plain",
          models: {
            tiny: {
              name: "Tiny",
              contextWindow: 1000,
              maxTokens: 100,
            },
          },
        },
      },
    });

    const registry = await ModelRegistry.load({ homeDir: home });
    const tiny = registry.requireModel({ providerId: "local", modelId: "tiny" });

    expect(tiny.availability).toBe("configuration-error");
    expect(tiny.diagnostics.map((diag) => diag.field)).toEqual(expect.arrayContaining(["baseUrl", "models.tiny.api"]));
  });
});
