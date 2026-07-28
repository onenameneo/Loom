import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "./registry";
import { createRuntimeModelsFromRegistry } from "./runtimeModels";

const tempDirs: string[] = [];

function writeModelsJson(home: string, value: unknown) {
  const dir = join(home, ".loom", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "models.json"), JSON.stringify(value, null, 2));
}

describe("runtime model construction", () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("creates Pi runtime providers from registry models and resolved file auth", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-home-"));
    tempDirs.push(home);
    writeModelsJson(home, {
      providers: {
        local: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "local-key",
          models: {
            llama: { api: "openai-completions", name: "Llama", contextWindow: 8192, maxTokens: 2048 },
          },
        },
      },
    });
    const registry = await ModelRegistry.load({ homeDir: home });

    const models = await createRuntimeModelsFromRegistry(registry);
    const model = models.getModel("local", "llama");
    const auth = await models.getAuth("local");

    expect(model).toMatchObject({
      id: "llama",
      provider: "local",
      api: "openai-completions",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(auth?.auth.apiKey).toBe("local-key");
  });
});
