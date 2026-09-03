import { ipcMain, type BrowserWindow } from "electron";
import { assertRendererSender } from "../fileIpcAuthorization";
import { sendToWindow } from "../ipcSafeSend";
import { normalizeMcpServerConfig, type McpSecretReference } from "./config";
import { removeMcpConsent, removeMcpServerConfig, loadMcpConfiguration, saveMcpServerConfig, type McpResolvedServer } from "./store";
import type { McpConnectionManager } from "./connection";
import { createMcpSecretStore } from "./secrets";
import type { McpServerSafeProjection } from "./types";
import type { McpToolProvider } from "./provider";

export interface McpIpcOptions {
  getWin: () => BrowserWindow | null;
  manager: McpConnectionManager;
  provider?: McpToolProvider;
  homeDir: string;
}

function safeCredentialReference(reference: McpSecretReference): { source: "environment" | "secret" | "oauth"; identifier: string } {
  return reference.source === "environment" ? { source: reference.source, identifier: reference.name } : reference.source === "secret" ? { source: reference.source, identifier: reference.key } : { source: reference.source, identifier: reference.profile };
}

function isSecretReference(value: string | McpSecretReference): value is McpSecretReference {
  return typeof value === "object";
}

export function safeProjection(server: McpResolvedServer, manager: McpConnectionManager, provider?: McpToolProvider): McpServerSafeProjection {
  const transport = server.config.transport;
  const secretStore = createMcpSecretStore();
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
            credentialReferences: Object.entries(transport.env ?? {}).flatMap(([name, reference]) => typeof reference === "string" ? [] : [{ name, ...safeCredentialReference(reference) }]),
            privilegeWarning: "This local MCP server runs with the client's operating-system privileges.",
          }
        : {
            type: transport.type,
            displayTarget,
            url: transport.url,
            headerNames: Object.keys(transport.headers ?? {}),
            headerValues: Object.entries(transport.headers ?? {}).flatMap(([name, value]) => typeof value === "string" && !/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name) ? [{ name, value }] : []),
            credentialReferences: Object.entries(transport.headers ?? {}).flatMap(([name, value]) => typeof value === "string" ? [] : [{ name, ...safeCredentialReference(value) }]),
          },
    },
    runtime: catalog ? { ...runtime, catalogRevision: catalog.revision, toolCount: catalog.tools.length, tools: catalog.tools.map((tool) => ({ name: tool.name, ...(tool.title ? { title: tool.title } : {}), readOnly: tool.annotations?.readOnlyHint === true, destructive: tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint !== true, exposed: tool.exposed })) } : runtime,
    secrets: [
      ...(transport.type === "stdio" ? Object.values(transport.env ?? {}).filter(isSecretReference) : Object.values(transport.headers ?? {}).filter(isSecretReference)),
    ].map((reference) => secretStore.projection(reference)),
  };
}

export function registerMcpIpc(options: McpIpcOptions): () => void {
  const channels = ["mcp:list", "mcp:get", "mcp:save", "mcp:remove", "mcp:setEnabled", "mcp:consent", "mcp:test", "mcp:reconnect", "mcp:refresh"] as const;
  const removeHandlers = () => channels.forEach((channel) => ipcMain.removeHandler(channel));
  const load = () => loadMcpConfiguration({ homeDir: options.homeDir });
  const find = (id: string) => load().servers.find((server) => server.config.id === id);

  ipcMain.handle("mcp:list", (event) => {
    assertRendererSender(event, options.getWin());
    const loaded = load();
    return { servers: loaded.servers.map((server) => safeProjection(server, options.manager, options.provider)), diagnostics: loaded.diagnostics, revision: Math.max(...loaded.servers.map((server) => server.config.revision), 0) };
  });
  ipcMain.handle("mcp:get", (event, arg: { id: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP server id.");
    const server = find(arg.id);
    return server ? safeProjection(server, options.manager, options.provider) : undefined;
  });
  ipcMain.handle("mcp:save", (event, arg: { config: unknown; preserveSensitiveHeaders?: unknown; clearSensitiveHeaders?: unknown; preserveEnvironmentNames?: unknown }) => {
    assertRendererSender(event, options.getWin());
    const normalized = normalizeMcpServerConfig(arg?.config);
    if (!normalized.config) return { ok: false, issues: normalized.issues };
    const headerNames = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9-]{1,128}$/.test(item)) : [];
    const environmentNames = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[A-Z_][A-Z0-9_]*$/.test(item.toUpperCase())).map((item) => item.toUpperCase()) : [];
    try { return { ok: true, config: saveMcpServerConfig({ homeDir: options.homeDir, config: normalized.config, preserveSensitiveHeaders: headerNames(arg?.preserveSensitiveHeaders), clearSensitiveHeaders: headerNames(arg?.clearSensitiveHeaders), preserveEnvironmentNames: environmentNames(arg?.preserveEnvironmentNames) }) }; }
    catch (error) { return { ok: false, issues: [{ code: "persistence", path: "", message: error instanceof Error ? error.message : String(error) }] }; }
  });
  ipcMain.handle("mcp:remove", async (event, arg: { id: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP registration request.");
    await options.manager.close(arg.id);
    removeMcpServerConfig({ homeDir: options.homeDir, id: arg.id });
    removeMcpConsent({ homeDir: options.homeDir, serverId: arg.id });
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
