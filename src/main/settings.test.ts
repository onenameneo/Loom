import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings, type Store } from "./store/store";
import { saveApiKey } from "./settings";

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
});
