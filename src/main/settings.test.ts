import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeMemorySettings, type Settings, type Store } from "./store/store";
import { accessSources, resolveModelConfig, saveApiKey } from "./settings";

class MemoryStore implements Pick<Store, "getSettings" | "getApiKeyEnc" | "setApiKeyEnc"> {
  settings: Settings = { ...DEFAULT_SETTINGS };
  key: string | undefined;
  getSettings() {
    return this.settings;
  }
  getApiKeyEnc() {
    return this.key;
  }
  setApiKeyEnc(enc: string | undefined) {
    this.key = enc;
  }
}

describe("settings credential path", () => {
  it("does not write API keys into the application store", () => {
    const store = new MemoryStore();

    const result = saveApiKey(store as unknown as Store, "secret");

    expect(store.getApiKeyEnc()).toBeUndefined();
    expect(result).toEqual({ encrypted: false, persisted: false, reason: "file-config-required" });
  });

  it("does not use legacy provider environment variables", () => {
    const store = new MemoryStore();
    const previousKey = process.env.ANTHROPIC_API_KEY;
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_API_KEY = "should-not-be-read";
    process.env.ANTHROPIC_BASE_URL = "https://should-not-be-read.example";

    try {
      expect(resolveModelConfig(store as unknown as Store)).toMatchObject({
        baseUrl: "",
        apiKey: "",
      });
      expect(accessSources(store as unknown as Store)).toEqual({ baseUrl: "default", model: "default", key: "none" });
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
    }
  });

  it("keeps background extraction opt-in during settings normalization", () => {
    expect(normalizeMemorySettings({ enabled: true }).backgroundExtraction).toBe(false);
    expect(normalizeMemorySettings({ enabled: true, backgroundExtraction: true }).backgroundExtraction).toBe(true);
    expect(DEFAULT_SETTINGS.memory.backgroundExtraction).toBe(false);
  });
});
