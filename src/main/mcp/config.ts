import { isAbsolute } from "node:path";

export const MCP_CONFIG_VERSION = 1 as const;
export const MCP_SERVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const MCP_TOOL_PATTERN = /^[a-zA-Z0-9_.*?-]{1,128}$/;

export type McpTrust = "untrusted";
export type McpExposureMode = "allowlist" | "all";
export type McpApprovalMode = "on-request" | "always" | "never";
export type McpApprovalScope = "once" | "node-session" | "persistent";
export type McpSecretReference =
  | { source: "environment"; name: string }
  | { source: "secret"; key: string }
  | { source: "oauth"; profile: string };

export interface McpStdioTransport {
  type: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | McpSecretReference>;
  inheritEnv?: string[];
}

export interface McpHttpTransport {
  type: "streamable-http";
  url: string;
  headers?: Record<string, string | McpSecretReference>;
}

export type McpTransport = McpStdioTransport | McpHttpTransport;
export interface McpExposurePolicy { mode: McpExposureMode; allow: string[]; deny: string[]; }
export interface McpApprovalPolicy { mode: McpApprovalMode; defaultScope: McpApprovalScope; }

export interface McpServerConfig {
  version: typeof MCP_CONFIG_VERSION;
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  /** Persisted safety policy; intentionally omitted from the primary connection form. */
  exposure: McpExposurePolicy;
  approval: McpApprovalPolicy;
  revision: number;
}

export type McpConfigIssueCode =
  | "root" | "unknown_field" | "server_id" | "display_name" | "scope" | "transport"
  | "stdio_command" | "stdio_args" | "stdio_cwd" | "stdio_env" | "http_url" | "http_header"
  | "exposure" | "approval" | "limit";
export interface McpConfigIssue { code: McpConfigIssueCode; path: string; message: string; }
export interface McpConfigNormalizationResult { config?: McpServerConfig; issues: McpConfigIssue[]; }

// Legacy fields are read for migration but never emitted by the new writer.
const ROOT_FIELDS = new Set(["version", "id", "name", "displayName", "scope", "enabled", "trust", "transport", "exposure", "approval", "revision"]);
const TRANSPORT_FIELDS = new Set(["type", "command", "args", "cwd", "env", "inheritEnv", "url", "headers", "allowLegacySse"]);

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function issue(code: McpConfigIssueCode, path: string, message: string): McpConfigIssue { return { code, path, message }; }

function normalizeReference(value: unknown): McpSecretReference | undefined {
  if (!isRecord(value) || typeof value.source !== "string") return undefined;
  if (value.source === "environment" && stringValue(value.name) && /^[A-Z_][A-Z0-9_]*$/.test(value.name)) return { source: "environment", name: value.name };
  if (value.source === "secret" && stringValue(value.key) && value.key.length <= 160) return { source: "secret", key: value.key };
  if (value.source === "oauth" && stringValue(value.profile) && value.profile.length <= 160) return { source: "oauth", profile: value.profile };
  return undefined;
}

function normalizeStringList(value: unknown, max: number, defaultValue?: string[]): string[] | undefined {
  if (value === undefined && defaultValue) return defaultValue;
  if (!Array.isArray(value) || value.length > max) return undefined;
  if (!value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256)) return undefined;
  return [...new Set(value)];
}

function validateHttpsUrl(value: unknown): string | undefined {
  if (!stringValue(value) || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return undefined;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
  } catch { return undefined; }
  return undefined;
}

function normalizeTransport(value: unknown, issues: McpConfigIssue[]): McpTransport | undefined {
  if (!isRecord(value) || typeof value.type !== "string") { issues.push(issue("transport", "transport", "A supported MCP transport is required.")); return undefined; }
  for (const field of Object.keys(value)) if (!TRANSPORT_FIELDS.has(field)) issues.push(issue("unknown_field", `transport.${field}`, "Unknown MCP configuration field."));
  if (value.type === "stdio") {
    if (!stringValue(value.command) || value.command.length > 512 || /[\r\n;&|`$<>]/.test(value.command) || value.command.includes(" ")) { issues.push(issue("stdio_command", "transport.command", "stdio command must be one executable name or path, not a shell expression.")); return undefined; }
    const args = normalizeStringList(value.args, 128, []);
    if (!args) { issues.push(issue("stdio_args", "transport.args", "stdio args must be a bounded string array.")); return undefined; }
    if (value.cwd !== undefined && (!stringValue(value.cwd) || !isAbsolute(value.cwd))) { issues.push(issue("stdio_cwd", "transport.cwd", "stdio cwd must be an absolute path when provided.")); return undefined; }
    const env: Record<string, string | McpSecretReference> = {};
    if (value.env !== undefined) {
      if (!isRecord(value.env) || Object.keys(value.env).length > 64) { issues.push(issue("stdio_env", "transport.env", "stdio env must contain bounded secret references.")); return undefined; }
      for (const [name, reference] of Object.entries(value.env)) {
        const normalized = typeof reference === "string" && reference.length > 0 && reference.length <= 2048 ? reference : normalizeReference(reference);
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || !normalized) { issues.push(issue("stdio_env", `transport.env.${name}`, "Environment values must be non-empty values or valid secret references.")); return undefined; }
        env[name] = normalized;
      }
    }
    const inheritEnv = normalizeStringList(value.inheritEnv, 64, []);
    if (!inheritEnv) { issues.push(issue("stdio_env", "transport.inheritEnv", "Inherited environment names must be a bounded string array.")); return undefined; }
    return { type: "stdio", command: value.command, args, ...(value.cwd ? { cwd: value.cwd } : {}), ...(Object.keys(env).length ? { env } : {}), ...(inheritEnv.length ? { inheritEnv } : {}) };
  }
  if (value.type === "streamable-http") {
    const url = validateHttpsUrl(value.url);
    if (!url) { issues.push(issue("http_url", "transport.url", "Remote MCP URL must use HTTPS; HTTP is allowed only for localhost.")); return undefined; }
    const headers: Record<string, string | McpSecretReference> = {};
    if (value.headers !== undefined) {
      if (!isRecord(value.headers) || Object.keys(value.headers).length > 64) { issues.push(issue("http_header", "transport.headers", "HTTP headers must be bounded key/value entries.")); return undefined; }
      for (const [name, headerValue] of Object.entries(value.headers)) {
        const normalized = typeof headerValue === "string" ? headerValue : normalizeReference(headerValue);
        if (!/^[A-Za-z0-9-]{1,128}$/.test(name) || !normalized || (typeof normalized === "string" && normalized.length > 2048)) { issues.push(issue("http_header", `transport.headers.${name}`, "HTTP headers must contain bounded key/value entries.")); return undefined; }
        headers[name] = normalized;
      }
    }
    return { type: "streamable-http", url, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  issues.push(issue("transport", "transport.type", "Unsupported MCP transport."));
  return undefined;
}

export function normalizeMcpServerConfig(input: unknown): McpConfigNormalizationResult {
  const issues: McpConfigIssue[] = [];
  if (!isRecord(input)) return { issues: [issue("root", "", "MCP server configuration must be an object.")] };
  for (const field of Object.keys(input)) if (!ROOT_FIELDS.has(field)) issues.push(issue("unknown_field", field, "Unknown MCP configuration field."));
  if (!stringValue(input.id) || !MCP_SERVER_ID_PATTERN.test(input.id)) issues.push(issue("server_id", "id", "Server id must be lowercase kebab-case and at most 64 characters."));
  const name = stringValue(input.name) ? input.name.slice(0, 160) : stringValue(input.displayName) ? input.displayName.slice(0, 160) : stringValue(input.id) ? input.id : "";
  if (!name) issues.push(issue("display_name", "name", "A server name is required."));
  const transport = normalizeTransport(input.transport, issues);
  const exposureInput = isRecord(input.exposure) ? input.exposure : {};
  const mode = exposureInput.mode === "allowlist" || exposureInput.mode === "all" || exposureInput.mode === undefined ? (exposureInput.mode ?? "all") : undefined;
  const allow = normalizeStringList(exposureInput.allow, 512) ?? [];
  const deny = normalizeStringList(exposureInput.deny, 512) ?? [];
  if (!mode || !allow.every((item) => MCP_TOOL_PATTERN.test(item)) || !deny.every((item) => MCP_TOOL_PATTERN.test(item))) issues.push(issue("exposure", "exposure", "Exposure mode and patterns are invalid."));
  const approvalInput = isRecord(input.approval) ? input.approval : {};
  const approvalMode = approvalInput.mode === "always" || approvalInput.mode === "never" || approvalInput.mode === "on-request" || approvalInput.mode === undefined ? (approvalInput.mode ?? "on-request") : undefined;
  const defaultScope = approvalInput.defaultScope === "node-session" || approvalInput.defaultScope === "persistent" || approvalInput.defaultScope === "once" || approvalInput.defaultScope === undefined ? (approvalInput.defaultScope ?? "once") : undefined;
  if (!approvalMode || !defaultScope) issues.push(issue("approval", "approval", "Approval mode and scope are invalid."));
  const revision = typeof input.revision === "number" && Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 1;
  if (revision > 1_000_000) issues.push(issue("limit", "revision", "Revision is out of bounds."));
  if (issues.some((item) => ["root", "server_id", "display_name", "transport", "stdio_command", "stdio_args", "stdio_cwd", "stdio_env", "http_url", "http_header", "exposure", "approval", "limit"].includes(item.code))) return { issues };
  return { issues, config: { version: MCP_CONFIG_VERSION, id: input.id as string, name, enabled: input.enabled !== false, transport: transport!, exposure: { mode: mode!, allow, deny }, approval: { mode: approvalMode!, defaultScope: defaultScope! }, revision } };
}
