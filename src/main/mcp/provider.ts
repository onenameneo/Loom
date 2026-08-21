import type { AgentTool } from "../agent/core/tool";
import type { McpClientLike, McpConnectionManager } from "./connection";
import { discoverMcpCatalog, catalogDiagnosticsAsMcpDiagnostics } from "./catalog";
import { mcpToolFromCatalog } from "./tools";
import { isMcpToolExposed, type McpResolvedServer } from "./store";
import { globalMcpPath, loadMcpConfiguration, saveMcpServerConfig } from "./store";
import { normalizeMcpServerConfig, type McpServerConfig } from "./config";
import { createMcpConfigTool } from "./configTool";
import type { McpCatalog } from "./types";

export interface McpToolProviderOptions {
  manager: McpConnectionManager;
  resolveServers: () => McpResolvedServer[] | Promise<McpResolvedServer[]>;
  homeDir?: string;
}
export interface McpToolProvider {
  toolsFor(nodeId: string): Promise<AgentTool[]>;
  prepare(nodeId: string): Promise<AgentTool[]>;
  refresh(server: McpResolvedServer): Promise<McpCatalog | undefined>;
  toolsForSync(nodeId: string): AgentTool[];
  invalidate(nodeId: string): void;
  markToolsChanged(serverId: string): void;
  catalogFor(serverId: string): McpCatalog | undefined;
  configTool: AgentTool;
}

export function createMcpToolProvider(options: McpToolProviderOptions): McpToolProvider {
  const catalogs = new Map<string, McpCatalog>();
  const staleCatalogs = new Set<string>();
  const nodeSnapshots = new Map<string, AgentTool[]>();
  const homeDir = options.homeDir;

  async function saveConfig(input: unknown): Promise<McpServerConfig> {
    const normalized = normalizeMcpServerConfig(input);
    if (!normalized.config || normalized.issues.some((issue) => issue.code !== "unknown_field")) {
      throw new Error(normalized.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") || "Invalid MCP configuration.");
    }
    const existing = loadMcpConfiguration({ homeDir }).servers.find((server) => server.config.id === normalized.config!.id);
    const config = existing && normalized.config.revision <= existing.config.revision
      ? { ...normalized.config, revision: existing.config.revision + 1 }
      : normalized.config;
    const saved = saveMcpServerConfig({ homeDir, config });
    await options.manager.close(saved.id);
    staleCatalogs.add(saved.id);
    return saved;
  }

  const configTool = createMcpConfigTool({
    targetPath: globalMcpPath(homeDir ?? process.env.HOME ?? "~"),
    saveConfig,
  });

  async function discover(server: McpResolvedServer) {
    const handle = await options.manager.connect(server.config);
    if (!handle) return undefined;
    const result = await discoverMcpCatalog(server.config, {
      listTools: (_params, callOptions) => handle.listTools(callOptions),
      getServerCapabilities: handle.client.getServerCapabilities,
      getServerVersion: handle.client.getServerVersion,
    } satisfies Pick<McpClientLike, "listTools" | "getServerCapabilities" | "getServerVersion"> as McpClientLike, { previousRevision: catalogs.get(server.config.id)?.revision });
    if (result.catalog) catalogs.set(server.config.id, result.catalog);
    staleCatalogs.delete(server.config.id);
    return result.catalog;
  }

  return {
    refresh: discover,
    async toolsFor(nodeId) {
      const snapshot = nodeSnapshots.get(nodeId);
      if (snapshot) return [...snapshot];
      const servers = await options.resolveServers();
      const tools: AgentTool[] = [configTool];
      for (const server of servers) {
        if (!server.config.enabled) continue;
        let catalog = catalogs.get(server.config.id);
        if (!catalog || staleCatalogs.has(server.config.id)) {
          try { catalog = await discover(server); } catch { continue; }
        }
        if (!catalog) continue;
        const handle = await options.manager.connect(server.config);
        if (!handle) continue;
        for (const catalogTool of catalog.tools) {
          if (!isMcpToolExposed(server, catalogTool.name)) continue;
          tools.push(mcpToolFromCatalog({ ...catalogTool, exposed: true }, handle));
        }
      }
      nodeSnapshots.set(nodeId, tools);
      return [...tools];
    },
    prepare(nodeId) { return this.toolsFor(nodeId); },
    toolsForSync(nodeId) { return [...(nodeSnapshots.get(nodeId) ?? [])]; },
    invalidate(nodeId) { nodeSnapshots.delete(nodeId); },
    markToolsChanged(serverId) { staleCatalogs.add(serverId); },
    catalogFor(serverId) { return catalogs.get(serverId); },
    configTool,
  };
}

export { catalogDiagnosticsAsMcpDiagnostics };
