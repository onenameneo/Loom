import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { authJsonPath } from "./paths";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

type CredentialMap = Record<string, Credential>;

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "api_key") return typeof candidate.key === "string" || candidate.key === undefined;
  return candidate.type === "oauth"
    && typeof candidate.refresh === "string"
    && typeof candidate.access === "string"
    && typeof candidate.expires === "number";
}

function readCredentials(filePath: string): CredentialMap {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isCredential(value))) as CredentialMap;
  } catch {
    return {};
  }
}

function writeCredentials(filePath: string, credentials: CredentialMap) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(filePath, 0o600); } catch { /* best effort on platforms without chmod semantics */ }
}

export function createJsonCredentialStore(homeDir: string): CredentialStore {
  const filePath = authJsonPath(homeDir);
  const locks = new Map<string, Promise<void>>();

  return {
    async read(providerId) {
      return readCredentials(filePath)[providerId];
    },
    async list() {
      const credentials = readCredentials(filePath);
      return Object.entries(credentials).map(([providerId, credential]): CredentialInfo => ({ providerId, type: credential.type }));
    },
    async modify(providerId, fn) {
      const previous = locks.get(providerId) ?? Promise.resolve();
      let resolveLock: () => void = () => undefined;
      const lock = new Promise<void>((resolve) => { resolveLock = resolve; });
      const chain = previous.then(() => lock);
      locks.set(providerId, chain);
      try {
        await previous;
        const credentials = readCredentials(filePath);
        const next = await fn(credentials[providerId]);
        if (next) credentials[providerId] = next;
        else delete credentials[providerId];
        writeCredentials(filePath, credentials);
        return next;
      } finally {
        resolveLock();
        if (locks.get(providerId) === chain) locks.delete(providerId);
      }
    },
    async delete(providerId) {
      await this.modify(providerId, async () => undefined);
    },
  };
}
