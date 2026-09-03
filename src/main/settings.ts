import type { Store } from "./store/store";

export type SourceKind = "settings" | "default";

export interface ResolvedModel {
  provider: string;
  baseUrl: string; // '' = 官方默认
  model: string;
  apiKey: string; // '' = 无
}

export interface AccessSource {
  baseUrl: SourceKind;
  model: SourceKind;
  key: SourceKind | "none";
}

const DEFAULT_MODEL = "claude-sonnet-4-5";
const LOCAL_KEY_PREFIX = "local:";
const LEGACY_PLAIN_PREFIX = "plain:";

export function keyStorageKind(): "local" {
  return "local";
}

export function saveApiKey(_store: Store, _plain: string): { encrypted: boolean; persisted: boolean; reason: "file-config-required" } {
  return { encrypted: false, persisted: false, reason: "file-config-required" };
}

export function readApiKey(store: Store): string {
  const enc = store.getApiKeyEnc();
  if (!enc) return "";
  if (enc.startsWith(LOCAL_KEY_PREFIX)) {
    return Buffer.from(enc.slice(LOCAL_KEY_PREFIX.length), "base64").toString("utf-8");
  }
  if (enc.startsWith(LEGACY_PLAIN_PREFIX)) {
    return Buffer.from(enc.slice(LEGACY_PLAIN_PREFIX.length), "base64").toString("utf-8");
  }
  // Legacy safeStorage values intentionally do not decrypt here. Decrypting on macOS
  // can trigger a Keychain prompt during app launch; re-save the key to migrate.
  return "";
}

// 保留旧 Settings access 结构的兼容读取；实际 Provider、模型和凭证
// 由 models.json / scoped settings 解析。
export function resolveModelConfig(store: Store): ResolvedModel {
  const a = store.getSettings().access;
  const model = a.model || DEFAULT_MODEL;
  return { provider: a.provider || "anthropic", baseUrl: a.baseUrl || "", model, apiKey: "" };
}

export function accessSources(store: Store): AccessSource {
  const a = store.getSettings().access;
  return {
    baseUrl: a.baseUrl ? "settings" : "default",
    model: a.model ? "settings" : "default",
    key: "none",
  };
}
