import type { AgentTool } from "../agent/core/tool";
import type { McpClientLike, McpConnectionManager } from "./connection";
import { discoverMcpCatalog, catalogDiagnosticsAsMcpDiagnostics } from "./catalog";
import { mcpToolFromCatalog } from "./tools";
import { isMcpToolExposed, type McpResolvedServer } from "./store";
import { globalMcpPath, loadMcpConfiguration, saveMcpServerConfig } from "./store";
import { normalizeMcpServerConfig, type McpServerConfig } from "./config";
import { createMcpConfigTool } from "./configTool";
import type { McpCatalog } from "./types";
import { resolvedMcpServerKey } from "./identity";

export interface McpProjectContext { projectId: string; projectName?: string; projectRoot: string; }

export interface McpToolProviderOptions {
  manager: McpConnectionManager;
  resolveServers: (nodeId?: string) => McpResolvedServer[] | Promise<McpResolvedServer[]>;
  resolveProjectContext?: (nodeId: string) => McpProjectContext | undefined;
  homeDir?: string;
}
export interface McpToolProvider {
  toolsFor(nodeId: string): Promise<AgentTool[]>;
  prepare(nodeId: string): Promise<AgentTool[]>;
  refresh(server: McpResolvedServer): Promise<McpCatalog | undefined>;
  toolsForSync(nodeId: string): AgentTool[];
  invalidate(nodeId: string): void;
  markToolsChanged(serverKey: string): void;
  catalogFor(serverId: string, serverKey?: string): McpCatalog | undefined;
  configTool: AgentTool;
}

export function createMcpToolProvider(options: McpToolProviderOptions): McpToolProvider {
  const catalogs = new Map<string, McpCatalog>();
  const staleCatalogs = new Set<string>();
  const nodeSnapshots = new Map<string, AgentTool[]>();
  const homeDir = options.homeDir;

  async function saveConfig(input: unknown, context?: McpProjectContext): Promise<McpServerConfig> {
    const normalized = normalizeMcpServerConfig(input);
    if (!normalized.config || normalized.issues.some((issue) => issue.code !== "unknown_field")) {
      throw new Error(normalized.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") || "Invalid MCP configuration.");
    }
    const existing = loadMcpConfiguration({ homeDir, projectRoot: context?.projectRoot, projectId: context?.projectId, projectName: context?.projectName }).servers.find((server) => server.config.id === normalized.config!.id);
    const config = existing && normalized.config.revision <= existing.config.revision
      ? { ...normalized.config, revision: existing.config.revision + 1 }
      : normalized.config;
    const saved = saveMcpServerConfig({ homeDir, scope: context ? "project" : "global", projectRoot: context?.projectRoot, config });
    const key = context ? resolvedMcpServerKey({ config: saved, scope: "project", projectRoot: context.projectRoot }) : resolvedMcpServerKey({ config: saved, scope: "global" });
    await options.manager.close(saved.id, key);
    staleCatalogs.add(key);
    return saved;
  }

  const nodeSnapshotKey = (nodeId: string, projectId?: string) => `${projectId ?? "global"}:${nodeId}`;

  const configTool = createMcpConfigTool({
    targetPath: globalMcpPath(homeDir ?? process.env.HOME ?? "~"),
    scope: "global",
    saveConfig,
  });

  async function discover(server: McpResolvedServer) {
    const serverKey = resolvedMcpServerKey(server);
    const handle = await options.manager.connect(server.config, { serverKey, scope: server.scope, projectId: server.projectId, sourcePath: server.sourcePath });
    if (!handle) return undefined;
    const result = await discoverMcpCatalog(server.config, {
      listTools: (_params, callOptions) => handle.listTools(callOptions),
      getServerCapabilities: handle.client.getServerCapabilities,
      getServerVersion: handle.client.getServerVersion,
    } satisfies Pick<McpClientLike, "listTools" | "getServerCapabilities" | "getServerVersion"> as McpClientLike, { previousRevision: catalogs.get(serverKey)?.revision });
    if (result.catalog) catalogs.set(serverKey, result.catalog);
    staleCatalogs.delete(serverKey);
    return result.catalog;
  }

  return {
    refresh: discover,
    async toolsFor(nodeId) {
      const projectContext = options.resolveProjectContext?.(nodeId);
      const snapshotKey = nodeSnapshotKey(nodeId, projectContext?.projectId);
      const snapshot = nodeSnapshots.get(snapshotKey);
      if (snapshot) return [...snapshot];
      const servers = await options.resolveServers(nodeId);
      const scopedConfigTool = projectContext ? createMcpConfigTool({
        targetPath: `${projectContext.projectRoot}/.loom/mcp.json`,
        scope: "project",
        saveConfig: (input) => saveConfig(input, projectContext),
      }) : configTool;
      const tools: AgentTool[] = [scopedConfigTool];
      for (const server of servers) {
        if (!server.config.enabled) continue;
        const serverKey = resolvedMcpServerKey(server);
        let catalog = catalogs.get(serverKey);
        if (!catalog || staleCatalogs.has(serverKey)) {
          try { catalog = await discover(server); } catch { continue; }
        }
        if (!catalog) continue;
        const handle = await options.manager.connect(server.config, { serverKey, scope: server.scope, projectId: server.projectId, sourcePath: server.sourcePath });
        if (!handle) continue;
        for (const catalogTool of catalog.tools) {
          if (!isMcpToolExposed(server, catalogTool.name)) continue;
          tools.push(mcpToolFromCatalog({ ...catalogTool, exposed: true }, handle));
        }
      }
      nodeSnapshots.set(snapshotKey, tools);
      return [...tools];
    },
    prepare(nodeId) { return this.toolsFor(nodeId); },
    toolsForSync(nodeId) {
      const projectId = options.resolveProjectContext?.(nodeId)?.projectId;
      return [...(nodeSnapshots.get(nodeSnapshotKey(nodeId, projectId)) ?? [])];
    },
    invalidate(nodeId) {
      for (const key of nodeSnapshots.keys()) if (key.endsWith(`:${nodeId}`)) nodeSnapshots.delete(key);
      nodeSnapshots.delete(nodeId);
    },
    markToolsChanged(serverKey) {
      staleCatalogs.add(serverKey);
      if (!serverKey.includes(":")) staleCatalogs.add(`global:${serverKey}`);
    },
    catalogFor(serverId, serverKey) { return catalogs.get(serverKey ?? serverId); },
    configTool,
  };
}

export { catalogDiagnosticsAsMcpDiagnostics };
