import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { safeStorage as electronSafeStorage } from "electron";
import type { McpSecretReference } from "./config";
import type { McpSecretStatus, McpSecretStatusProjection } from "./types";

type MaybePromise<T> = T | Promise<T>;

export interface McpCredentialVault {
  get(key: string): Promise<string | undefined>;
  has(key: string): boolean;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  isAvailable(): boolean;
}

export interface McpSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface McpSecretStore {
  resolve(reference: McpSecretReference): Promise<string | undefined>;
  status(reference: McpSecretReference): McpSecretStatus;
  projection(reference: McpSecretReference): McpSecretStatusProjection;
}

export interface McpSecretStoreDeps {
  environment?: NodeJS.ProcessEnv;
  vault?: McpCredentialVault;
  secret?: (key: string) => MaybePromise<string | undefined>;
  secretStatus?: (key: string) => boolean;
  oauth?: (profile: string) => MaybePromise<string | undefined>;
  oauthStatus?: (profile: string) => boolean;
}

function referenceKey(reference: McpSecretReference): string {
  return reference.source === "environment" ? reference.name : reference.source === "secret" ? reference.key : reference.profile;
}

export function createMcpSecretStore(deps: McpSecretStoreDeps = {}): McpSecretStore {
  const environment = deps.environment ?? process.env;
  const hasValue = (reference: McpSecretReference): boolean => {
    if (reference.source === "environment") return typeof environment[reference.name] === "string" && environment[reference.name]!.length > 0;
    if (reference.source === "secret") return deps.vault ? deps.vault.has(reference.key) : deps.secretStatus?.(reference.key) === true;
    return false;
  };

  return {
    async resolve(reference) {
      if (reference.source === "environment") return environment[reference.name];
      if (reference.source === "secret") return deps.vault ? await deps.vault.get(reference.key) : deps.secret ? await deps.secret(reference.key) : undefined;
      return deps.oauth ? await deps.oauth(reference.profile) : undefined;
    },
    status(reference) {
      if (hasValue(reference)) return "configured";
      if (reference.source === "secret") {
        if (deps.vault && !deps.vault.isAvailable()) return "unavailable";
        return hasValue(reference) ? "configured" : "missing";
      }
      if (reference.source === "oauth") return deps.oauthStatus?.(reference.profile) === true ? "configured" : "missing";
      return "missing";
    },
    projection(reference) {
      return { source: reference.source, key: referenceKey(reference), status: this.status(reference) };
    },
  };
}

interface McpSecretFile {
  version: 1;
  secrets: Record<string, string>;
}

function credentialVaultPath(homeDir: string): string {
  return join(homeDir, ".loom", "mcp-secrets.json");
}

function readSecretFile(filePath: string): McpSecretFile {
  if (!existsSync(filePath)) return { version: 1, secrets: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { version: 1, secrets: {} };
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || !candidate.secrets || typeof candidate.secrets !== "object" || Array.isArray(candidate.secrets)) return { version: 1, secrets: {} };
    return {
      version: 1,
      secrets: Object.fromEntries(Object.entries(candidate.secrets).filter(([key, value]) => typeof key === "string" && typeof value === "string")),
    };
  } catch {
    return { version: 1, secrets: {} };
  }
}

function writeSecretFile(filePath: string, file: McpSecretFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tempPath, 0o600); } catch { /* best effort on platforms without chmod semantics */ }
  renameSync(tempPath, filePath);
  try { chmodSync(filePath, 0o600); } catch { /* best effort on platforms without chmod semantics */ }
}

export function createMcpCredentialVault(options: { homeDir?: string; filePath?: string; safeStorage?: McpSafeStorageLike } = {}): McpCredentialVault {
  const safeStorage = options.safeStorage ?? electronSafeStorage;
  const filePath = options.filePath ?? credentialVaultPath(options.homeDir ?? homedir());
  const available = safeStorage.isEncryptionAvailable();
  const encrypted = readSecretFile(filePath);
  const values = new Map<string, string>();
  if (available) {
    for (const [key, value] of Object.entries(encrypted.secrets)) {
      try { values.set(key, safeStorage.decryptString(Buffer.from(value, "base64"))); } catch { /* ignore corrupt entries */ }
    }
  }

  return {
    isAvailable: () => available,
    has: (key) => available && values.has(key),
    get: async (key) => available ? values.get(key) : undefined,
    async set(key, value) {
      if (!available) throw new Error("MCP secure storage is unavailable on this device.");
      if (!key || !value) throw new Error("MCP managed credentials require a non-empty key and value.");
      values.set(key, value);
      const secrets = Object.fromEntries([...values.entries()].map(([entryKey, entryValue]) => [entryKey, safeStorage.encryptString(entryValue).toString("base64")]));
      writeSecretFile(filePath, { version: 1, secrets });
    },
    async delete(key) {
      values.delete(key);
      if (existsSync(filePath)) {
        const secrets = readSecretFile(filePath).secrets;
        delete secrets[key];
        writeSecretFile(filePath, { version: 1, secrets });
      }
    },
  };
}

const SENSITIVE_KEY = /(api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|credential|token)/i;

export function redactMcpValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMcpValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactMcpValue(child)]));
}

export function redactMcpText(value: string, secrets: readonly string[] = []): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length >= 3) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}
