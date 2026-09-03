import type { McpSecretReference } from "./config";
import type { McpSecretStatus, McpSecretStatusProjection } from "./types";

type MaybePromise<T> = T | Promise<T>;

export interface McpSecretStore {
  resolve(reference: McpSecretReference): Promise<string | undefined>;
  status(reference: McpSecretReference): McpSecretStatus;
  projection(reference: McpSecretReference): McpSecretStatusProjection;
}

export interface McpSecretStoreDeps {
  environment?: NodeJS.ProcessEnv;
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
    if (reference.source === "secret") return deps.secretStatus?.(reference.key) === true;
    return false;
  };

  return {
    async resolve(reference) {
      if (reference.source === "environment") return environment[reference.name];
      if (reference.source === "secret") return deps.secret ? await deps.secret(reference.key) : undefined;
      return deps.oauth ? await deps.oauth(reference.profile) : undefined;
    },
    status(reference) {
      if (hasValue(reference)) return "configured";
      if (reference.source === "secret") return hasValue(reference) ? "configured" : "missing";
      if (reference.source === "oauth") return deps.oauthStatus?.(reference.profile) === true ? "configured" : "missing";
      return "missing";
    },
    projection(reference) {
      return { source: reference.source, key: referenceKey(reference), status: this.status(reference) };
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
