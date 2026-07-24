import type { Store } from "./store/store";

export type SourceKind = "settings" | "env" | "default";

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

export function saveApiKey(store: Store, plain: string): { encrypted: boolean } {
  if (!plain) {
    store.setApiKeyEnc(undefined);
    return { encrypted: false };
  }
  store.setApiKeyEnc(`${LOCAL_KEY_PREFIX}${Buffer.from(plain, "utf-8").toString("base64")}`);
  return { encrypted: false };
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

// 设置优先、env 回退。沿用 P0 的 baseUrl/model 语义。
export function resolveModelConfig(store: Store): ResolvedModel {
  const a = store.getSettings().access;
  const model = a.model || process.env.MODEL_ID || DEFAULT_MODEL;
  const baseUrl = a.baseUrl || process.env.ANTHROPIC_BASE_URL || "";
  const apiKey = readApiKey(store) || process.env.ANTHROPIC_API_KEY || "";
  return { provider: a.provider || "anthropic", baseUrl, model, apiKey };
}

export function accessSources(store: Store): AccessSource {
  const a = store.getSettings().access;
  const hasStoredKey = Boolean(store.getApiKeyEnc());
  return {
    baseUrl: a.baseUrl ? "settings" : process.env.ANTHROPIC_BASE_URL ? "env" : "default",
    model: a.model ? "settings" : process.env.MODEL_ID ? "env" : "default",
    key: hasStoredKey ? "settings" : process.env.ANTHROPIC_API_KEY ? "env" : "none",
  };
}
