import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeMcpServerConfig, type McpConfigIssue, type McpExposurePolicy, type McpServerConfig } from "./config";

export interface McpConfigStoreOptions { homeDir?: string; }
export interface McpResolvedServer { config: McpServerConfig; }
export interface LoadedMcpConfiguration { servers: McpResolvedServer[]; diagnostics: McpConfigIssue[]; source?: string; }
interface McpConfigFile { version: 1; servers: Record<string, unknown>; }
interface McpConsentFile { version: 1; servers: Record<string, number>; }

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function globalMcpPath(homeDir: string): string { return join(homeDir, ".loom", "mcp.json"); }
function consentPath(homeDir: string): string { return join(homeDir, ".loom", "mcp-consent.json"); }

function readMcpFile(filePath: string): { configs: McpServerConfig[]; diagnostics: McpConfigIssue[] } {
  if (!existsSync(filePath)) return { configs: [], diagnostics: [] };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown; }
  catch (error) { return { configs: [], diagnostics: [{ code: "root", path: filePath, message: error instanceof Error ? error.message : `Unable to parse ${filePath}.` }] }; }
  if (!isRecord(raw)) return { configs: [], diagnostics: [{ code: "root", path: filePath, message: "MCP config must contain an object." }] };
  const servers = isRecord(raw.servers) ? raw.servers : undefined;
  if (!servers) return { configs: [], diagnostics: [{ code: "root", path: "servers", message: "MCP config must contain a servers object." }] };
  const configs: McpServerConfig[] = [];
  const diagnostics: McpConfigIssue[] = [];
  for (const [id, value] of Object.entries(servers)) {
    const result = normalizeMcpServerConfig(isRecord(value) ? { ...value, id } : value);
    diagnostics.push(...result.issues.map((item) => ({ ...item, path: `servers.${id}${item.path ? `.${item.path}` : ""}` })));
    if (result.config) configs.push({ ...result.config, id });
  }
  return { configs, diagnostics };
}

function patternMatches(pattern: string, toolName: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(toolName);
}
function policyAllows(policy: McpExposurePolicy, toolName: string): boolean {
  if (policy.deny.some((pattern) => patternMatches(pattern, toolName))) return false;
  return policy.mode === "all" || policy.allow.some((pattern) => patternMatches(pattern, toolName));
}
export function isMcpToolExposed(server: McpResolvedServer, toolName: string): boolean { return policyAllows(server.config.exposure, toolName); }

export function loadMcpConfiguration(options: McpConfigStoreOptions = {}): LoadedMcpConfiguration {
  const homeDir = options.homeDir ?? homedir();
  const source = globalMcpPath(homeDir);
  const loaded = readMcpFile(source);
  return { servers: loaded.configs.map((config) => ({ config })), diagnostics: loaded.diagnostics, source: existsSync(source) ? source : undefined };
}

function readWritableConfig(filePath: string): McpConfigFile {
  if (!existsSync(filePath)) return { version: 1, servers: {} };
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return { version: 1, servers: isRecord(raw) && isRecord(raw.servers) ? { ...raw.servers } : {} };
  } catch { return { version: 1, servers: {} }; }
}
function writeConfig(filePath: string, file: McpConfigFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function loadMcpConsent(options: McpConfigStoreOptions = {}): Record<string, number> {
  const filePath = consentPath(options.homeDir ?? homedir());
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.servers)) return {};
    const result: Record<string, number> = {};
    for (const [id, revision] of Object.entries(raw.servers)) {
      if (/^[a-z][a-z0-9-]{0,63}$/.test(id) && typeof revision === "number" && Number.isInteger(revision) && revision >= 0) result[id] = revision;
    }
    return result;
  } catch { return {}; }
}

export function saveMcpConsent(options: McpConfigStoreOptions & { serverId: string; configRevision: number }): void {
  const homeDir = options.homeDir ?? homedir();
  const filePath = consentPath(homeDir);
  const current = loadMcpConsent({ homeDir });
  current[options.serverId] = options.configRevision;
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  const file: McpConsentFile = { version: 1, servers: current };
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function removeMcpConsent(options: McpConfigStoreOptions & { serverId: string }): void {
  const homeDir = options.homeDir ?? homedir();
  const filePath = consentPath(homeDir);
  const current = loadMcpConsent({ homeDir });
  if (!(options.serverId in current)) return;
  delete current[options.serverId];
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  const file: McpConsentFile = { version: 1, servers: current };
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function saveMcpServerConfig(options: { homeDir?: string; config: Partial<McpServerConfig> & { id: string; transport: unknown } }): McpServerConfig {
  const result = normalizeMcpServerConfig(options.config);
  if (!result.config || result.issues.some((item) => item.code !== "unknown_field")) throw new Error(result.issues.map((item) => `${item.path}: ${item.message}`).join("; ") || "Invalid MCP configuration.");
  const filePath = globalMcpPath(options.homeDir ?? homedir());
  const file = readWritableConfig(filePath);
  file.servers[result.config.id] = result.config;
  writeConfig(filePath, file);
  return result.config;
}

export function removeMcpServerConfig(options: { homeDir?: string; id: string }): void {
  const filePath = globalMcpPath(options.homeDir ?? homedir());
  const file = readWritableConfig(filePath);
  delete file.servers[options.id];
  if (!existsSync(filePath) && Object.keys(file.servers).length === 0) return;
  writeConfig(filePath, file);
}

export { globalMcpPath };
