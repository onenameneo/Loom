import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeMcpServerConfig, type McpConfigIssue, type McpExposurePolicy, type McpServerConfig } from "./config";
import { createMcpServerKey, type McpScope } from "./identity";

export interface McpConfigStoreOptions { homeDir?: string; projectRoot?: string; projectId?: string; projectName?: string; }
export interface McpResolvedServer {
  config: McpServerConfig;
  scope?: McpScope;
  projectId?: string;
  projectName?: string;
  projectRoot?: string;
  sourcePath?: string;
  serverKey?: string;
  overridesGlobal?: boolean;
}
export interface LoadedMcpConfiguration { servers: McpResolvedServer[]; diagnostics: McpConfigIssue[]; source?: string; sources?: string[]; }
interface McpConfigFile { version: 1; servers: Record<string, unknown>; }
interface McpConsentFile { version: 2; servers: Record<string, number>; }

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function globalMcpPath(homeDir: string): string { return join(homeDir, ".loom", "mcp.json"); }
function projectMcpPath(projectRoot: string): string { return join(projectRoot, ".loom", "mcp.json"); }
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
  const globalPath = globalMcpPath(homeDir);
  const globalLoaded = readMcpFile(globalPath);
  const globalServers = globalLoaded.configs.map((config) => ({
    config,
    scope: "global" as const,
    sourcePath: globalPath,
    serverKey: createMcpServerKey("global", config.id),
  }));
  const diagnostics = globalLoaded.diagnostics.map((item) => ({ ...item, path: `${globalPath}:${item.path}` }));
  const sources = existsSync(globalPath) ? [globalPath] : [];
  if (!options.projectRoot) {
    return { servers: globalServers, diagnostics, source: existsSync(globalPath) ? globalPath : undefined, sources };
  }

  const projectPath = projectMcpPath(options.projectRoot);
  const projectLoaded = readMcpFile(projectPath);
  diagnostics.push(...projectLoaded.diagnostics.map((item) => ({ ...item, path: `${projectPath}:${item.path}` })));
  if (existsSync(projectPath)) sources.push(projectPath);
  const projectServers = projectLoaded.configs.map((config) => ({
    config,
    scope: "project" as const,
    projectId: options.projectId,
    projectName: options.projectName,
    projectRoot: options.projectRoot,
    sourcePath: projectPath,
    serverKey: createMcpServerKey("project", config.id, options.projectRoot),
    overridesGlobal: globalServers.some((server) => server.config.id === config.id),
  }));
  const projectById = new Map(projectServers.map((server) => [server.config.id, server]));
  const servers = globalServers.map((global) => {
    const project = projectById.get(global.config.id);
    if (!project) return global;
    projectById.delete(global.config.id);
    return { ...project, config: mergeScopedConfig(global.config, project.config) };
  });
  servers.push(...projectById.values());
  return { servers, diagnostics, source: existsSync(globalPath) ? globalPath : undefined, sources };
}

function mergeScopedConfig(global: McpServerConfig, project: McpServerConfig): McpServerConfig {
  const deny = [...new Set([...global.exposure.deny, ...project.exposure.deny])];
  const allow = global.exposure.mode === "allowlist" && project.exposure.mode === "allowlist"
    ? global.exposure.allow.filter((item) => project.exposure.allow.includes(item))
    : global.exposure.mode === "allowlist" ? [...global.exposure.allow]
      : project.exposure.mode === "allowlist" ? [...project.exposure.allow] : [];
  const mode = global.exposure.mode === "all" && project.exposure.mode === "all" ? "all" : "allowlist";
  const approvalRank = { never: 0, "on-request": 1, always: 2 } as const;
  const scopeRank = { persistent: 0, "node-session": 1, once: 2 } as const;
  const approvalMode = approvalRank[global.approval.mode] >= approvalRank[project.approval.mode] ? global.approval.mode : project.approval.mode;
  const defaultScope = scopeRank[global.approval.defaultScope] >= scopeRank[project.approval.defaultScope] ? global.approval.defaultScope : project.approval.defaultScope;
  return {
    ...project,
    enabled: global.enabled && project.enabled,
    exposure: { mode, allow, deny },
    approval: { mode: approvalMode, defaultScope },
    revision: Math.max(global.revision, project.revision),
  };
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
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  replaceFile(tempPath, filePath);
}

function replaceFile(tempPath: string, filePath: string): void {
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    // Windows does not replace an existing destination with renameSync.
    if (process.platform !== "win32") throw error;
    if (!existsSync(filePath)) throw error;
    unlinkSync(filePath);
    renameSync(tempPath, filePath);
  }
}

export function loadMcpConsent(options: McpConfigStoreOptions = {}): Record<string, number> {
  const filePath = consentPath(options.homeDir ?? homedir());
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2) || !isRecord(raw.servers)) return {};
    const result: Record<string, number> = {};
    for (const [id, revision] of Object.entries(raw.servers)) {
      const validKey = /^[a-z][a-z0-9-]{0,63}$/.test(id) || /^global:[a-z][a-z0-9-]{0,63}$/.test(id) || /^project:[a-f0-9]{32}:[a-z][a-z0-9-]{0,63}$/.test(id);
      if (validKey && typeof revision === "number" && Number.isInteger(revision) && revision >= 0) result[raw.version === 1 ? `global:${id}` : id] = revision;
    }
    return result;
  } catch { return {}; }
}

function consentKey(options: { serverId: string; serverKey?: string; scope?: McpScope; projectRoot?: string }): string {
  if (options.serverKey) return options.serverKey;
  if (options.scope === "project") return createMcpServerKey("project", options.serverId, options.projectRoot);
  return options.serverId;
}

export function saveMcpConsent(options: McpConfigStoreOptions & { serverId: string; serverKey?: string; scope?: McpScope; configRevision: number }): void {
  const homeDir = options.homeDir ?? homedir();
  const filePath = consentPath(homeDir);
  const current = loadMcpConsent({ homeDir });
  current[consentKey(options)] = options.configRevision;
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  const file: McpConsentFile = { version: 2, servers: current };
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  replaceFile(tempPath, filePath);
}

export function removeMcpConsent(options: McpConfigStoreOptions & { serverId: string; serverKey?: string; scope?: McpScope; projectRoot?: string }): void {
  const homeDir = options.homeDir ?? homedir();
  const filePath = consentPath(homeDir);
  const current = loadMcpConsent({ homeDir });
  const key = consentKey(options);
  const keys = options.scope === "project"
    ? [key]
    : [key, options.serverId, `global:${options.serverId}`];
  if (!keys.some((candidate) => candidate in current)) return;
  for (const candidate of keys) delete current[candidate];
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  const file: McpConsentFile = { version: 2, servers: current };
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  replaceFile(tempPath, filePath);
}

function mergePreservedHeaders(input: Partial<McpServerConfig> & { id: string; transport: unknown }, existing: McpServerConfig | undefined, preserve: string[] = [], clear: string[] = []): Partial<McpServerConfig> & { id: string; transport: unknown } {
  if (!existing || existing.transport.type !== "streamable-http" || !isRecord(input.transport) || input.transport.type !== "streamable-http") return input;
  const nextHeaders = isRecord(input.transport.headers) ? { ...input.transport.headers } : {};
  const existingHeaders = existing.transport.headers ?? {};
  const findHeader = (headers: Record<string, unknown>, name: string) => Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  for (const name of preserve) {
    const existingName = findHeader(existingHeaders, name);
    if (!existingName || findHeader(nextHeaders, name)) continue;
    nextHeaders[existingName] = existingHeaders[existingName]!;
  }
  const sensitiveHeader = (name: string) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name);
  for (const [name] of Object.entries(existingHeaders)) {
    if (sensitiveHeader(name) && !findHeader(nextHeaders, name) && !preserve.some((item) => item.toLowerCase() === name.toLowerCase())) delete nextHeaders[name];
  }
  for (const name of clear) {
    const nextName = findHeader(nextHeaders, name);
    if (nextName) delete nextHeaders[nextName];
  }
  return { ...input, transport: { ...input.transport, ...(Object.keys(nextHeaders).length ? { headers: nextHeaders } : { headers: undefined }) } };
}

function mergePreservedEnvironment(input: Partial<McpServerConfig> & { id: string; transport: unknown }, existing: McpServerConfig | undefined, preserve: string[] = []): Partial<McpServerConfig> & { id: string; transport: unknown } {
  if (!existing || existing.transport.type !== "stdio" || !isRecord(input.transport) || input.transport.type !== "stdio") return input;
  const nextEnv = isRecord(input.transport.env) ? { ...input.transport.env } : {};
  const existingEnv = existing.transport.env ?? {};
  for (const name of preserve) if (!(name in nextEnv) && name in existingEnv) nextEnv[name] = existingEnv[name]!;
  return { ...input, transport: { ...input.transport, ...(Object.keys(nextEnv).length ? { env: nextEnv } : { env: undefined }) } };
}

export function saveMcpServerConfig(options: { homeDir?: string; scope?: McpScope; projectRoot?: string; config: Partial<McpServerConfig> & { id: string; transport: unknown }; preserveSensitiveHeaders?: string[]; clearSensitiveHeaders?: string[]; preserveEnvironmentNames?: string[] }): McpServerConfig {
  const scope = options.scope ?? "global";
  if (scope === "project" && !options.projectRoot) throw new Error("Project MCP configuration requires a project root.");
  const filePath = scope === "project" ? projectMcpPath(options.projectRoot!) : globalMcpPath(options.homeDir ?? homedir());
  const file = readWritableConfig(filePath);
  const existingRaw = file.servers[options.config.id];
  const existing = normalizeMcpServerConfig(existingRaw).config;
  const preserved = mergePreservedEnvironment(options.config, existing, options.preserveEnvironmentNames);
  const result = normalizeMcpServerConfig(mergePreservedHeaders(preserved, existing, options.preserveSensitiveHeaders, options.clearSensitiveHeaders));
  if (!result.config || result.issues.some((item) => item.code !== "unknown_field")) throw new Error(result.issues.map((item) => `${item.path}: ${item.message}`).join("; ") || "Invalid MCP configuration.");
  file.servers[result.config.id] = result.config;
  writeConfig(filePath, file);
  return result.config;
}

export function removeMcpServerConfig(options: { homeDir?: string; scope?: McpScope; projectRoot?: string; id: string }): void {
  const scope = options.scope ?? "global";
  if (scope === "project" && !options.projectRoot) throw new Error("Project MCP configuration requires a project root.");
  const filePath = scope === "project" ? projectMcpPath(options.projectRoot!) : globalMcpPath(options.homeDir ?? homedir());
  const file = readWritableConfig(filePath);
  delete file.servers[options.id];
  if (!existsSync(filePath) && Object.keys(file.servers).length === 0) return;
  writeConfig(filePath, file);
}

export { globalMcpPath, projectMcpPath };
