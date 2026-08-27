import { ipcMain, type BrowserWindow } from "electron";
import { assertRendererSender } from "../fileIpcAuthorization";
import { sendToWindow } from "../ipcSafeSend";
import { normalizeMcpServerConfig, type McpSecretReference, type McpServerConfig } from "./config";
import { removeMcpConsent, removeMcpServerConfig, loadMcpConfiguration, saveMcpServerConfig, type McpResolvedServer } from "./store";
import type { McpConnectionManager } from "./connection";
import { createMcpSecretStore, type McpCredentialVault, type McpSecretStore } from "./secrets";
import type { McpServerSafeProjection } from "./types";
import type { McpToolProvider } from "./provider";

export interface McpIpcOptions {
  getWin: () => BrowserWindow | null;
  manager: McpConnectionManager;
  provider?: McpToolProvider;
  homeDir: string;
  secretStore?: McpSecretStore;
  vault?: McpCredentialVault;
}

function safeCredentialReference(reference: McpSecretReference): { source: "environment" | "secret" | "oauth"; identifier: string } {
  return reference.source === "environment" ? { source: reference.source, identifier: reference.name } : reference.source === "secret" ? { source: reference.source, identifier: reference.key } : { source: reference.source, identifier: reference.profile };
}

export function safeProjection(server: McpResolvedServer, manager: McpConnectionManager, provider?: McpToolProvider, secretStore = createMcpSecretStore()): McpServerSafeProjection {
  const transport = server.config.transport;
  const displayTarget = transport.type === "stdio" ? [transport.command, ...transport.args].join(" ").slice(0, 1_024) : transport.url;
  const { transport: _transport, ...config } = server.config;
  const runtime = manager.status(server.config.id);
  const catalog = provider?.catalogFor(server.config.id);
  return {
    config: {
      ...config,
      transport: transport.type === "stdio"
        ? {
            type: transport.type,
            displayTarget,
            command: transport.command,
            args: [...transport.args],
            cwd: transport.cwd,
            environmentNames: Object.keys(transport.env ?? {}),
            inheritedEnvironmentNames: [...(transport.inheritEnv ?? [])],
            credentialReferences: Object.entries(transport.env ?? {}).map(([name, reference]) => ({ name, ...safeCredentialReference(reference) })),
            privilegeWarning: "This local MCP server runs with the client's operating-system privileges.",
          }
        : {
            type: transport.type,
            displayTarget,
            url: transport.url,
            headerNames: Object.keys(transport.headers ?? {}),
            headerValues: Object.entries(transport.headers ?? {}).flatMap(([name, value]) => typeof value === "string" ? [{ name, value }] : []),
            credentialReferences: Object.entries(transport.headers ?? {}).flatMap(([name, value]) => typeof value === "string" ? [] : [{ name, ...safeCredentialReference(value) }]),
          },
    },
    runtime: catalog ? { ...runtime, catalogRevision: catalog.revision, toolCount: catalog.tools.length, tools: catalog.tools.map((tool) => ({ name: tool.name, ...(tool.title ? { title: tool.title } : {}), readOnly: tool.annotations?.readOnlyHint === true, destructive: tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint !== true, exposed: tool.exposed })) } : runtime,
    secrets: [
      ...(transport.type === "stdio" ? Object.values(transport.env ?? {}) : Object.values(transport.headers ?? {}).filter((value): value is McpSecretReference => Boolean(value) && typeof value === "object" && "source" in value)),
    ].map((reference) => secretStore.projection(reference)),
  };
}

function authorizationReference(config: McpServerConfig): McpSecretReference | undefined {
  if (config.transport.type !== "streamable-http") return undefined;
  const entry = Object.entries(config.transport.headers ?? {}).find(([name]) => name.toLowerCase() === "authorization");
  return entry && typeof entry[1] === "object" ? entry[1] : undefined;
}

function managedAuthorizationKey(serverId: string): string {
  return `mcp.${serverId}.authorization`;
}

export async function saveMcpServerWithCredential(options: {
  homeDir: string;
  config: unknown;
  bearerToken?: unknown;
  clearManagedBearer?: unknown;
  vault: McpCredentialVault;
}): Promise<McpServerConfig> {
  const normalized = normalizeMcpServerConfig(options.config);
  if (!normalized.config) throw new Error(normalized.issues.map((item) => `${item.path}: ${item.message}`).join("; ") || "Invalid MCP configuration.");
  if (options.bearerToken !== undefined && typeof options.bearerToken !== "string") throw new Error("Invalid MCP Bearer credential.");
  if (options.clearManagedBearer !== undefined && typeof options.clearManagedBearer !== "boolean") throw new Error("Invalid MCP credential clear request.");
  const config = normalized.config;
  const incomingToken = typeof options.bearerToken === "string" ? options.bearerToken.trim() : "";
  const clearManagedBearer = options.clearManagedBearer === true;
  const reference = authorizationReference(config);
  const managedKey = managedAuthorizationKey(config.id);
  if (incomingToken && (reference?.source !== "secret" || reference.key !== managedKey)) throw new Error("Managed Bearer credentials require a Loom Secret reference.");
  if (clearManagedBearer && reference?.source === "secret") throw new Error("Clearing a managed Bearer credential must remove its Secret reference.");

  const existing = loadMcpConfiguration({ homeDir: options.homeDir }).servers.find((server) => server.config.id === config.id)?.config;
  const previousReference = existing ? authorizationReference(existing) : undefined;
  const previousKey = previousReference?.source === "secret" ? previousReference.key : undefined;
  const previousValue = previousKey ? await options.vault.get(previousKey) : undefined;
  const hadPreviousValue = previousKey ? options.vault.has(previousKey) : false;

  if (incomingToken) {
    await options.vault.set(managedKey, incomingToken);
  }
  try {
    const saved = saveMcpServerConfig({ homeDir: options.homeDir, config });
    const shouldRemovePrevious = previousKey && previousKey !== managedKey || previousKey && clearManagedBearer;
    if (shouldRemovePrevious) await options.vault.delete(previousKey);
    if (!reference || reference.source !== "secret") {
      if (previousKey) await options.vault.delete(previousKey);
    }
    return saved;
  } catch (error) {
    if (incomingToken) {
      if (hadPreviousValue && previousValue !== undefined) await options.vault.set(managedKey, previousValue);
      else await options.vault.delete(managedKey);
    }
    throw error;
  }
}

export function registerMcpIpc(options: McpIpcOptions): () => void {
  const channels = ["mcp:list", "mcp:get", "mcp:save", "mcp:remove", "mcp:setEnabled", "mcp:consent", "mcp:test", "mcp:reconnect", "mcp:refresh"] as const;
  const removeHandlers = () => channels.forEach((channel) => ipcMain.removeHandler(channel));
  const load = () => loadMcpConfiguration({ homeDir: options.homeDir });
  const find = (id: string) => load().servers.find((server) => server.config.id === id);

  ipcMain.handle("mcp:list", (event) => {
    assertRendererSender(event, options.getWin());
    const loaded = load();
    return { servers: loaded.servers.map((server) => safeProjection(server, options.manager, options.provider, options.secretStore)), diagnostics: loaded.diagnostics, revision: Math.max(...loaded.servers.map((server) => server.config.revision), 0), managedCredentialStorage: options.vault?.isAvailable() === false ? "unavailable" : "available" };
  });
  ipcMain.handle("mcp:get", (event, arg: { id: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP server id.");
    const server = find(arg.id);
    return server ? safeProjection(server, options.manager, options.provider, options.secretStore) : undefined;
  });
  ipcMain.handle("mcp:save", async (event, arg: { config: unknown; bearerToken?: unknown; clearManagedBearer?: unknown }) => {
    assertRendererSender(event, options.getWin());
    const normalized = normalizeMcpServerConfig(arg?.config);
    if (!normalized.config) return { ok: false, issues: normalized.issues };
    try {
      if ((arg?.bearerToken !== undefined || arg?.clearManagedBearer === true) && !options.vault) throw new Error("MCP secure storage is unavailable on this device.");
      const config = await saveMcpServerWithCredential({ homeDir: options.homeDir, config: normalized.config, bearerToken: arg?.bearerToken, clearManagedBearer: arg?.clearManagedBearer, vault: options.vault ?? { get: async () => undefined, has: () => false, set: async () => { throw new Error("MCP secure storage is unavailable on this device."); }, delete: async () => undefined, isAvailable: () => false } });
      return { ok: true, config };
    }
    catch (error) { return { ok: false, issues: [{ code: "persistence", path: "", message: error instanceof Error ? error.message : String(error) }] }; }
  });
  ipcMain.handle("mcp:remove", async (event, arg: { id: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP registration request.");
    const source = find(arg.id);
    await options.manager.close(arg.id);
    removeMcpServerConfig({ homeDir: options.homeDir, id: arg.id });
    removeMcpConsent({ homeDir: options.homeDir, serverId: arg.id });
    const reference = source ? authorizationReference(source.config) : undefined;
    if (reference?.source === "secret") await options.vault?.delete(reference.key);
    return { ok: true };
  });
  ipcMain.handle("mcp:setEnabled", async (event, arg: { id: string; enabled: boolean }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "") || typeof arg?.enabled !== "boolean") throw new Error("Invalid MCP enablement request.");
    const source = find(arg.id);
    if (!source) throw new Error("MCP server registration not found.");
    const saved = saveMcpServerConfig({ homeDir: options.homeDir, config: { ...source.config, enabled: arg.enabled } });
    if (!arg.enabled) await options.manager.close(arg.id);
    return { ok: true, config: saved };
  });

  async function connectAction(event: Electron.IpcMainInvokeEvent, arg: { id: string; consented?: boolean }) {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "") || (arg.consented !== undefined && typeof arg.consented !== "boolean")) throw new Error("Invalid MCP connection request.");
    const source = find(arg.id);
    if (!source) throw new Error("MCP server registration not found.");
    if (arg.consented && source.config.transport.type === "stdio") options.manager.approveConsent(source.config.id, source.config.revision);
    const handle = await options.manager.connect(source.config, { force: true });
    const catalog = handle && options.provider ? await options.provider.refresh(source) : undefined;
    return { ok: Boolean(handle), status: options.manager.status(source.config.id), catalog: catalog ? { revision: catalog.revision, toolCount: catalog.tools.length } : undefined };
  }
  ipcMain.handle("mcp:consent", async (event, arg: { id: string; revision: number }) => {
    assertRendererSender(event, options.getWin());
    if (!Number.isInteger(arg?.revision) || (arg?.revision ?? -1) < 0) throw new Error("Invalid MCP consent request.");
    const source = find(arg.id);
    if (!source || source.config.revision !== arg.revision) throw new Error("MCP configuration changed; review consent again.");
    options.manager.approveConsent(source.config.id, source.config.revision);
    const handle = await options.manager.connect(source.config, { force: true });
    const catalog = handle && options.provider ? await options.provider.refresh(source) : undefined;
    return { ok: Boolean(handle), status: options.manager.status(source.config.id), catalog: catalog ? { revision: catalog.revision, toolCount: catalog.tools.length } : undefined };
  });
  ipcMain.handle("mcp:test", connectAction);
  ipcMain.handle("mcp:reconnect", connectAction);
  ipcMain.handle("mcp:refresh", connectAction);
  return () => removeHandlers();
}

export function emitMcpStatus(getWin: () => BrowserWindow | null, status: unknown) { sendToWindow(getWin, "mcp:status", status); }
