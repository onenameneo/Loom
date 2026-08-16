import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "./registry";
import { loadScopedModelSettings, resolveSelectedModel, resolveStoredModelSelection } from "./scopes";

const tempDirs: string[] = [];

async function tempRoot(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("model configuration scopes", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    delete process.env.LOOM_PROVIDER_KEY;
  });

  it("deep-merges project settings over global settings", async () => {
    const home = await tempRoot("loom-home-");
    const project = await tempRoot("loom-project-");
    writeJson(join(home, ".loom", "agent", "settings.json"), {
      defaults: { model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" } },
      ui: { modelSelector: { showUnavailable: true, density: "compact" } },
    });
    writeJson(join(project, ".loom", "settings.json"), {
      defaults: { model: { providerId: "openai", modelId: "gpt-5.2" } },
      ui: { modelSelector: { density: "comfortable" } },
    });

    const scoped = loadScopedModelSettings({ homeDir: home, projectRoot: project });

    expect(scoped.settings.defaults?.model).toEqual({ providerId: "openai", modelId: "gpt-5.2" });
    expect(scoped.settings.ui).toEqual({ modelSelector: { showUnavailable: true, density: "comfortable" } });
  });

  it("rejects credential-bearing project settings with diagnostics", async () => {
    const home = await tempRoot("loom-home-");
    const project = await tempRoot("loom-project-");
    writeJson(join(project, ".loom", "settings.json"), {
      providers: { anthropic: { apiKey: "plain", headers: { authorization: "token" } } },
      apiKey: "plain",
    });

    const scoped = loadScopedModelSettings({ homeDir: home, projectRoot: project });

    expect(scoped.diagnostics.map((diag) => diag.code)).toEqual(
      expect.arrayContaining(["project-credential-field", "project-credential-field"]),
    );
    expect(scoped.settings).not.toHaveProperty("providers");
  });

  it("resolves node/session, project, global, then first available model", async () => {
    const home = await tempRoot("loom-home-");
    const project = await tempRoot("loom-project-");
    process.env.LOOM_PROVIDER_KEY = "secret";
    writeJson(join(home, ".loom", "agent", "models.json"), {
      providers: {
        anthropic: { apiKey: "$LOOM_PROVIDER_KEY" },
        local: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "local",
          models: {
            llama: { api: "openai-completions", name: "Llama", contextWindow: 8192, maxTokens: 2048 },
          },
        },
      },
    });
    writeJson(join(home, ".loom", "agent", "settings.json"), {
      defaults: { model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" } },
    });
    writeJson(join(project, ".loom", "settings.json"), {
      defaults: { model: { providerId: "local", modelId: "llama" } },
    });
    const registry = await ModelRegistry.load({ homeDir: home });
    const scoped = loadScopedModelSettings({ homeDir: home, projectRoot: project });

    expect(resolveSelectedModel({ registry, scoped }).ref).toEqual({ providerId: "local", modelId: "llama" });
    expect(
      resolveSelectedModel({
        registry,
        scoped,
        explicit: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      }).ref,
    ).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-4-5" });

    const globalOnly = loadScopedModelSettings({ homeDir: home });
    const globalSelected = resolveSelectedModel({ registry, scoped: globalOnly });
    expect(globalSelected.ref).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-4-5" });
    expect(globalSelected.source).toBe("global");
  });

  it("preserves unavailable explicit selections instead of falling back", async () => {
    const home = await tempRoot("loom-home-");
    const registry = await ModelRegistry.load({ homeDir: home });
    const scoped = loadScopedModelSettings({ homeDir: home });

    const selected = resolveSelectedModel({
      registry,
      scoped,
      explicit: { providerId: "missing", modelId: "gone" },
    });

    expect(selected.ref).toEqual({ providerId: "missing", modelId: "gone" });
    expect(selected.available).toBe(false);
    expect(selected.diagnostic?.code).toBe("unknown-model");
  });

  it("resolves legacy stored selections before applying normal scope precedence", async () => {
    const home = await tempRoot("loom-home-");
    process.env.LOOM_PROVIDER_KEY = "secret";
    writeJson(join(home, ".loom", "agent", "models.json"), {
      providers: {
        local: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "local",
          models: { llama: { api: "openai-completions", contextWindow: 8192, maxTokens: 2048 } },
        },
      },
    });
    const registry = await ModelRegistry.load({ homeDir: home });
    const scoped = loadScopedModelSettings({ homeDir: home });

    const selected = resolveStoredModelSelection({ registry, scoped, explicit: "llama" });

    expect(selected.ref).toEqual({ providerId: "local", modelId: "llama" });
    expect(selected.model?.capabilities.contextWindow).toBe(8192);
    expect(selected.model?.capabilities.maxOutputTokens).toBe(2048);
  });
});
