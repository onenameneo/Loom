import type { McpConnectionHandle, McpConnectionManager } from "./connection";
import type { McpToolProvider } from "./provider";
import type { McpResolvedServer } from "./store";

/** Starts enabled registrations without delaying app/window startup when one fails. */
export async function connectEnabledMcpServers(options: {
  servers: McpResolvedServer[];
  manager: McpConnectionManager;
  provider: Pick<McpToolProvider, "refresh">;
}): Promise<void> {
  await Promise.allSettled(options.servers
    .filter((server) => server.config.enabled)
    .map(async (server) => {
      const handle: McpConnectionHandle | undefined = await options.manager.connect(server.config);
      if (handle) await options.provider.refresh(server);
    }));
}
