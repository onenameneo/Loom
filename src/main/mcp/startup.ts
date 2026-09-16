import type { McpConnectionHandle, McpConnectionManager } from "./connection";
import type { McpToolProvider } from "./provider";
import type { McpResolvedServer } from "./store";
import { resolvedMcpServerKey } from "./identity";

/** Starts enabled registrations without delaying app/window startup when one fails. */
export async function connectEnabledMcpServers(options: {
  servers: McpResolvedServer[];
  manager: McpConnectionManager;
  provider: Pick<McpToolProvider, "refresh">;
}): Promise<void> {
  await Promise.allSettled(options.servers
    .filter((server) => server.config.enabled)
    .map(async (server) => {
      const serverKey = server.serverKey ?? (server.scope ? resolvedMcpServerKey(server) : server.config.id);
      const handle: McpConnectionHandle | undefined = server.scope || server.serverKey
        ? await options.manager.connect(server.config, { serverKey, scope: server.scope, projectId: server.projectId, sourcePath: server.sourcePath })
        : await options.manager.connect(server.config);
      if (handle) await options.provider.refresh(server);
    }));
}
