import { ipcMain, type BrowserWindow } from "electron";
import { assertRendererSender } from "../fileIpcAuthorization";
import { sendToWindow } from "../ipcSafeSend";
import { normalizeMcpServerConfig, type McpSecretReference } from "./config";
import { removeMcpConsent, removeMcpServerConfig, loadMcpConfiguration, saveMcpServerConfig, type McpResolvedServer } from "./store";
import type { McpConnectionManager } from "./connection";
import { createMcpSecretStore } from "./secrets";
import type { McpServerSafeProjection } from "./types";
import type { McpToolProvider } from "./provider";
import { resolvedMcpServerKey, type McpScope } from "./identity";

export interface McpIpcOptions {
  getWin: () => BrowserWindow | null;
  manager: McpConnectionManager;
  provider?: McpToolProvider;
  homeDir: string;
  resolveProject?: (projectId: string) => { id: string; name: string; sourceRoot: string } | undefined;
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
  const serverKey = resolvedMcpServerKey(server);
  const runtime = manager.status(server.config.id, serverKey);
  const catalog = provider?.catalogFor(server.config.id, serverKey);
  return {
    scope: server.scope ?? "global",
    projectId: server.projectId,
    projectName: server.projectName,
    sourcePath: server.sourcePath,
    overridesGlobal: server.overridesGlobal,
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
  const projectFor = (projectId: unknown) => typeof projectId === "string" && projectId.trim() ? options.resolveProject?.(projectId) : undefined;
  const requireProject = (projectId: unknown) => {
    const project = projectFor(projectId);
    if (!project) throw new Error("Project MCP configuration requires a registered active Project.");
    return project;
  };
  const load = (projectId?: string) => {
    const project = projectId ? requireProject(projectId) : undefined;
    return loadMcpConfiguration({ homeDir: options.homeDir, projectRoot: project?.sourceRoot, projectId: project?.id, projectName: project?.name });
  };
  const find = (id: string, scope: McpScope = "global", projectId?: string) => {
    if (scope === "project") {
      const project = requireProject(projectId);
      return load(project.id).servers.find((server) => server.config.id === id && server.scope === "project");
    }
    return load().servers.find((server) => server.config.id === id && (server.scope ?? "global") === "global");
  };

  ipcMain.handle("mcp:list", (event, arg: { projectId?: unknown } = {}) => {
    assertRendererSender(event, options.getWin());
    const project = arg.projectId ? requireProject(arg.projectId) : undefined;
    const loaded = load(project?.id);
    return { servers: loaded.servers.map((server) => safeProjection(server, options.manager, options.provider)), diagnostics: loaded.diagnostics, revision: Math.max(...loaded.servers.map((server) => server.config.revision), 0), projectId: project?.id };
  });
  ipcMain.handle("mcp:get", (event, arg: { id: string; scope?: McpScope; projectId?: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP server id.");
    const server = find(arg.id, arg.scope, arg.projectId);
    return server ? safeProjection(server, options.manager, options.provider) : undefined;
  });
  ipcMain.handle("mcp:save", (event, arg: { config: unknown; scope?: McpScope; projectId?: string; preserveSensitiveHeaders?: unknown; clearSensitiveHeaders?: unknown; preserveEnvironmentNames?: unknown }) => {
    assertRendererSender(event, options.getWin());
    const normalized = normalizeMcpServerConfig(arg?.config);
    if (!normalized.config) return { ok: false, issues: normalized.issues };
    const headerNames = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9-]{1,128}$/.test(item)) : [];
    const environmentNames = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[A-Z_][A-Z0-9_]*$/.test(item.toUpperCase())).map((item) => item.toUpperCase()) : [];
    try {
      const scope = arg.scope ?? "global";
      const project = scope === "project" ? requireProject(arg.projectId) : undefined;
      return { ok: true, config: saveMcpServerConfig({ homeDir: options.homeDir, scope, projectRoot: project?.sourceRoot, config: normalized.config, preserveSensitiveHeaders: headerNames(arg?.preserveSensitiveHeaders), clearSensitiveHeaders: headerNames(arg?.clearSensitiveHeaders), preserveEnvironmentNames: environmentNames(arg?.preserveEnvironmentNames) }) };
    }
    catch (error) { return { ok: false, issues: [{ code: "persistence", path: "", message: error instanceof Error ? error.message : String(error) }] }; }
  });
  ipcMain.handle("mcp:remove", async (event, arg: { id: string; scope?: McpScope; projectId?: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "")) throw new Error("Invalid MCP registration request.");
    const scope = arg.scope ?? "global";
    const source = find(arg.id, scope, arg.projectId);
    if (!source) throw new Error("MCP server registration not found.");
    const project = scope === "project" ? requireProject(arg.projectId) : undefined;
    const key = resolvedMcpServerKey(source);
    await options.manager.close(arg.id, key);
    removeMcpServerConfig({ homeDir: options.homeDir, scope, projectRoot: project?.sourceRoot, id: arg.id });
    removeMcpConsent({ homeDir: options.homeDir, serverId: arg.id, serverKey: key });
    return { ok: true };
  });
  ipcMain.handle("mcp:setEnabled", async (event, arg: { id: string; enabled: boolean; scope?: McpScope; projectId?: string }) => {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "") || typeof arg?.enabled !== "boolean") throw new Error("Invalid MCP enablement request.");
    const scope = arg.scope ?? "global";
    const source = find(arg.id, scope, arg.projectId);
    if (!source) throw new Error("MCP server registration not found.");
    const project = scope === "project" ? requireProject(arg.projectId) : undefined;
    const saved = saveMcpServerConfig({ homeDir: options.homeDir, scope, projectRoot: project?.sourceRoot, config: { ...source.config, enabled: arg.enabled } });
    if (!arg.enabled) await options.manager.close(arg.id, resolvedMcpServerKey(source));
    return { ok: true, config: saved };
  });

  async function connectAction(event: Electron.IpcMainInvokeEvent, arg: { id: string; consented?: boolean; scope?: McpScope; projectId?: string }) {
    assertRendererSender(event, options.getWin());
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(arg?.id ?? "") || (arg.consented !== undefined && typeof arg.consented !== "boolean")) throw new Error("Invalid MCP connection request.");
    const source = find(arg.id, arg.scope, arg.projectId);
    if (!source) throw new Error("MCP server registration not found.");
    const key = resolvedMcpServerKey(source);
    if (arg.consented && source.config.transport.type === "stdio") options.manager.approveConsent(source.config.id, source.config.revision, key);
    const handle = await options.manager.connect(source.config, { force: true, serverKey: key, scope: source.scope, projectId: source.projectId, sourcePath: source.sourcePath });
    const catalog = handle && options.provider ? await options.provider.refresh(source) : undefined;
    return { ok: Boolean(handle), status: options.manager.status(source.config.id, key), catalog: catalog ? { revision: catalog.revision, toolCount: catalog.tools.length } : undefined };
  }
  ipcMain.handle("mcp:consent", async (event, arg: { id: string; revision: number; scope?: McpScope; projectId?: string }) => {
    assertRendererSender(event, options.getWin());
    if (!Number.isInteger(arg?.revision) || (arg?.revision ?? -1) < 0) throw new Error("Invalid MCP consent request.");
    const source = find(arg.id, arg.scope, arg.projectId);
    if (!source || source.config.revision !== arg.revision) throw new Error("MCP configuration changed; review consent again.");
    const key = resolvedMcpServerKey(source);
    options.manager.approveConsent(source.config.id, source.config.revision, key);
    const handle = await options.manager.connect(source.config, { force: true, serverKey: key, scope: source.scope, projectId: source.projectId, sourcePath: source.sourcePath });
    const catalog = handle && options.provider ? await options.provider.refresh(source) : undefined;
    return { ok: Boolean(handle), status: options.manager.status(source.config.id, key), catalog: catalog ? { revision: catalog.revision, toolCount: catalog.tools.length } : undefined };
  });
  ipcMain.handle("mcp:test", connectAction);
  ipcMain.handle("mcp:reconnect", connectAction);
  ipcMain.handle("mcp:refresh", connectAction);
  return () => removeHandlers();
}

export function emitMcpStatus(getWin: () => BrowserWindow | null, status: unknown) { sendToWindow(getWin, "mcp:status", status); }
