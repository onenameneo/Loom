import { safeStorage } from "electron";
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

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function saveApiKey(store: Store, plain: string): { encrypted: boolean } {
  if (!plain) {
    store.setApiKeyEnc(undefined);
    return { encrypted: false };
  }
  if (encryptionAvailable()) {
    const enc = safeStorage.encryptString(plain).toString("base64");
    store.setApiKeyEnc(enc);
    return { encrypted: true };
  }
  // 加密不可用（少数 Linux 无 keychain）：不静默明文，交由 UI 告知；
  // 这里以带前缀的明文兜底存储，读时能识别。
  store.setApiKeyEnc(`plain:${Buffer.from(plain).toString("base64")}`);
  return { encrypted: false };
}

export function readApiKey(store: Store): string {
  const enc = store.getApiKeyEnc();
  if (!enc) return "";
  if (enc.startsWith("plain:")) {
    return Buffer.from(enc.slice(6), "base64").toString("utf-8");
  }
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  } catch {
    return "";
  }
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
