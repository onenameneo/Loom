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
  bearerTokenEnv: string;
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
    bearerTokenEnv: "",
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
  const headerEnvNames = credentialReferences.filter((reference) => reference.name.toLowerCase() !== "authorization").map((reference) => reference.name);
  const staticHeaders = transport.headerValues ?? [];
  return {
    ...form,
    id: server.config.id,
    name: server.config.name,
    transport: "streamable-http",
    url: transport.url ?? "",
    bearerTokenEnv: bearer?.identifier ?? "",
    headers: staticHeaders.length ? staticHeaders.map(({ name, value }) => ({ key: name, value })) : [{ key: "", value: "" }],
    headerEnv: headerEnvNames.length ? headerEnvNames.map((key) => ({ key, value: refValue(server, key) })) : [{ key: "", value: "" }],
    enabled: server.config.enabled,
  };
}

function nonEmpty(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function rows(values: McpKeyValueRow[]): McpKeyValueRow[] { return values.map((row) => ({ key: row.key.trim(), value: row.value.trim() })).filter((row) => row.key || row.value); }
function isSensitiveHttpHeader(name: string): boolean { return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name); }
function usableStaticHeaders(form: McpFormState): McpKeyValueRow[] {
  const bearerConfigured = form.transport === "streamable-http" && form.bearerTokenEnv.trim().length > 0;
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
  if (form.bearerTokenEnv.trim()) headers.Authorization = { source: "environment", name: form.bearerTokenEnv.trim().toUpperCase() };
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
    if (form.bearerTokenEnv.trim() && !/^[A-Z_][A-Z0-9_]*$/.test(form.bearerTokenEnv.trim().toUpperCase())) return "invalid-env-ref";
  }
  return undefined;
}
