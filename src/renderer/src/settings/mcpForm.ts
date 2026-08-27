import type { McpConfigInput, McpSafeServerDto } from "../../../common/mcp";

export type McpKeyValueRow = { key: string; value: string };
export type McpFormState = {
  /** Internal identity; it is intentionally not rendered as a user-editable field. */
  id: string;
  name: string;
  transport: "stdio" | "streamable-http";
  command: string;
  args: string[];
  env: McpKeyValueRow[];
  inheritEnv: string[];
  cwd: string;
  url: string;
  bearerCredentialSource: "managed" | "environment";
  bearerToken: string;
  bearerTokenEnv: string;
  managedCredentialConfigured: boolean;
  managedCredentialReference: boolean;
  managedCredentialKey?: string;
  managedCredentialStatus?: "configured" | "missing" | "expired" | "unavailable";
  clearManagedBearer: boolean;
  headers: McpKeyValueRow[];
  headerEnv: McpKeyValueRow[];
  enabled: boolean;
};

export function emptyMcpForm(): McpFormState {
  return {
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    args: [""],
    env: [{ key: "", value: "" }],
    inheritEnv: [""],
    cwd: "",
    url: "https://",
    bearerCredentialSource: "managed",
    bearerToken: "",
    bearerTokenEnv: "",
    managedCredentialConfigured: false,
    managedCredentialReference: false,
    clearManagedBearer: false,
    headers: [{ key: "", value: "" }],
    headerEnv: [{ key: "", value: "" }],
    enabled: true,
  };
}

function refValue(server: McpSafeServerDto, name: string): string {
  return server.config.transport.credentialReferences?.find((reference) => reference.name.toLowerCase() === name.toLowerCase())?.identifier ?? "";
}

export function formFromMcpServer(server: McpSafeServerDto): McpFormState {
  const form = emptyMcpForm();
  const transport = server.config.transport;
  if (transport.type === "stdio") {
    const names = [...new Set([...(transport.environmentNames ?? []), ...(transport.credentialReferences?.map((reference) => reference.name) ?? [])])];
    return {
      ...form,
      id: server.config.id,
      name: server.config.name,
      transport: "stdio",
      command: transport.command ?? "",
      args: transport.args?.length ? [...transport.args] : [""],
      env: names.length ? names.map((key) => ({ key, value: refValue(server, key) })) : [{ key: "", value: "" }],
      inheritEnv: transport.inheritedEnvironmentNames?.length ? [...transport.inheritedEnvironmentNames] : [""],
      cwd: transport.cwd ?? "",
      enabled: server.config.enabled,
    };
  }
  const credentialReferences = transport.credentialReferences ?? [];
  const bearer = credentialReferences.find((reference) => reference.name.toLowerCase() === "authorization");
  const managedSecret = bearer?.source === "secret" ? server.secrets.find((secret) => secret.source === "secret" && secret.key === bearer.identifier) : undefined;
  const headerEnvNames = credentialReferences.filter((reference) => reference.name.toLowerCase() !== "authorization").map((reference) => reference.name);
  const staticHeaders = transport.headerValues ?? [];
  return {
    ...form,
    id: server.config.id,
    name: server.config.name,
    transport: "streamable-http",
    url: transport.url ?? "",
    bearerCredentialSource: bearer?.source === "environment" ? "environment" : "managed",
    bearerToken: "",
    bearerTokenEnv: bearer?.source === "environment" ? bearer.identifier : "",
    managedCredentialConfigured: managedSecret?.status === "configured",
    managedCredentialReference: bearer?.source === "secret",
    managedCredentialKey: bearer?.source === "secret" ? bearer.identifier : undefined,
    managedCredentialStatus: managedSecret?.status,
    clearManagedBearer: false,
    headers: staticHeaders.length ? staticHeaders.map(({ name, value }) => ({ key: name, value })) : [{ key: "", value: "" }],
    headerEnv: headerEnvNames.length ? headerEnvNames.map((key) => ({ key, value: refValue(server, key) })) : [{ key: "", value: "" }],
    enabled: server.config.enabled,
  };
}

function nonEmpty(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function rows(values: McpKeyValueRow[]): McpKeyValueRow[] { return values.map((row) => ({ key: row.key.trim(), value: row.value.trim() })).filter((row) => row.key || row.value); }
function isSensitiveHttpHeader(name: string): boolean { return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name); }
function managedBearerKey(form: McpFormState): string { return form.managedCredentialKey ?? `mcp.${serverId(form)}.authorization`; }
function bearerReference(form: McpFormState): { source: "environment"; name: string } | { source: "secret"; key: string } | undefined {
  if (form.clearManagedBearer) return undefined;
  if ((form.bearerCredentialSource ?? "environment") === "managed") {
    if (form.bearerToken.trim() || form.managedCredentialConfigured || form.managedCredentialReference) return { source: "secret", key: managedBearerKey(form) };
    // Preserve the pre-managed form shape for callers that still populate
    // bearerTokenEnv without the source discriminator.
    if (form.bearerTokenEnv.trim()) return { source: "environment", name: form.bearerTokenEnv.trim().toUpperCase() };
    return undefined;
  }
  const name = form.bearerTokenEnv.trim();
  return name ? { source: "environment", name: name.toUpperCase() } : undefined;
}
function usableStaticHeaders(form: McpFormState): McpKeyValueRow[] {
  const bearerConfigured = form.transport === "streamable-http" && Boolean(bearerReference(form));
  return rows(form.headers).filter((row) => !(bearerConfigured && row.key.toLowerCase() === "authorization"));
}
function serverId(form: McpFormState): string {
  if (form.id.trim()) return form.id.trim().toLowerCase();
  return form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function mcpFormToConfig(form: McpFormState, revision = 1): McpConfigInput {
  const envRows = rows(form.env);
  const env = Object.fromEntries(envRows.map((row) => [row.key.toUpperCase(), { source: "environment", name: row.value.toUpperCase() }]));
  const headers: Record<string, unknown> = Object.fromEntries(usableStaticHeaders(form).map((row) => [row.key, isSensitiveHttpHeader(row.key) ? { source: "environment", name: row.value.toUpperCase() } : row.value]));
  const bearer = form.transport === "streamable-http" ? bearerReference(form) : undefined;
  if (bearer) headers.Authorization = bearer;
  for (const row of rows(form.headerEnv)) if (!(form.bearerTokenEnv.trim() && row.key.toLowerCase() === "authorization")) headers[row.key] = { source: "environment", name: row.value.toUpperCase() };
  const transport = form.transport === "stdio"
    ? { type: "stdio" as const, command: form.command.trim(), args: nonEmpty(form.args), ...(envRows.length ? { env } : {}), ...(nonEmpty(form.inheritEnv).length ? { inheritEnv: nonEmpty(form.inheritEnv) } : {}), ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}) }
    : { type: "streamable-http" as const, url: form.url.trim(), ...(Object.keys(headers).length ? { headers } : {}) };
  return {
    version: 1,
    id: serverId(form),
    name: form.name.trim(),
    enabled: form.enabled,
    transport,
    exposure: { mode: "all", allow: [], deny: [] },
    approval: { mode: "on-request", defaultScope: "once" },
    revision,
  };
}

export function mcpFormToSaveRequest(form: McpFormState, revision = 1): { config: McpConfigInput; bearerToken?: string; clearManagedBearer?: boolean } {
  const bearerToken = form.transport === "streamable-http" && (form.bearerCredentialSource ?? "environment") === "managed" ? form.bearerToken.trim() : "";
  return {
    config: mcpFormToConfig(form, revision),
    ...(bearerToken ? { bearerToken } : {}),
    ...(form.clearManagedBearer ? { clearManagedBearer: true } : {}),
  };
}

export function validateMcpForm(form: McpFormState): string | undefined {
  const id = serverId(form);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) return "invalid-id";
  if (!form.name.trim()) return "missing-name";
  if (form.transport === "stdio" && (!form.command.trim() || /[\s\r\n;&|`$<>]/.test(form.command.trim()))) return "invalid-command";
  if (form.transport === "stdio" && form.cwd.trim() && !form.cwd.trim().startsWith("/")) return "invalid-cwd";
  if (form.transport === "streamable-http") {
    try {
      const url = new URL(form.url.trim());
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return "invalid-url";
    } catch { return "invalid-url"; }
  }
  const referenceRows = form.transport === "stdio" ? form.env : form.headerEnv;
  for (const row of referenceRows) if (row.key.trim() || row.value.trim()) {
    if (!row.key.trim() || !row.value.trim()) return "incomplete-pair";
    if (form.transport === "stdio" && !/^[A-Z_][A-Z0-9_]*$/.test(row.key.trim().toUpperCase())) return "invalid-env-key";
    if (!/^[A-Z_][A-Z0-9_]*$/.test(row.value.trim().toUpperCase())) return "invalid-env-ref";
  }
  if (form.transport === "streamable-http") {
    for (const row of usableStaticHeaders(form)) {
      if (!row.key || !row.value) return "incomplete-pair";
      if (isSensitiveHttpHeader(row.key) && !/^[A-Z_][A-Z0-9_]*$/.test(row.value.toUpperCase())) return "invalid-env-ref";
    }
    if ((form.bearerCredentialSource ?? "environment") === "environment" && form.bearerTokenEnv.trim() && !/^[A-Z_][A-Z0-9_]*$/.test(form.bearerTokenEnv.trim().toUpperCase())) return "invalid-env-ref";
  }
  return undefined;
}
