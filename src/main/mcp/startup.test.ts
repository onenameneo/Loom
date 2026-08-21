import { describe, expect, it, vi } from "vitest";
import { connectEnabledMcpServers } from "./startup";
import type { McpConnectionManager } from "./connection";
import type { McpServerConfig } from "./config";
import type { McpResolvedServer } from "./store";

function server(id: string, enabled = true): McpResolvedServer {
  const config: McpServerConfig = {
    version: 1,
    id,
    name: id,
    enabled,
    transport: { type: "streamable-http", url: "https://example.com/mcp" },
    exposure: { mode: "all", allow: [], deny: [] },
    approval: { mode: "on-request", defaultScope: "once" },
    revision: 1,
  };
  return { config };
}

describe("MCP startup", () => {
  it("connects and discovers enabled servers while ignoring disabled ones", async () => {
    const connect = vi.fn(async (config: McpServerConfig) => config.enabled ? ({ serverId: config.id } as never) : undefined);
    const refresh = vi.fn(async () => undefined);
    await connectEnabledMcpServers({
      servers: [server("remote"), server("disabled", false)],
      manager: { connect, status: vi.fn(), approveConsent: vi.fn(), close: vi.fn(), closeAll: vi.fn() } as never,
      provider: { refresh },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: "remote" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not prevent other servers from starting when one fails", async () => {
    const connect = vi.fn(async (config: McpServerConfig) => {
      if (config.id === "broken") throw new Error("offline");
      return { serverId: config.id } as never;
    });
    const refresh = vi.fn(async () => undefined);
    await expect(connectEnabledMcpServers({
      servers: [server("broken"), server("healthy")],
      manager: { connect, status: vi.fn(), approveConsent: vi.fn(), close: vi.fn(), closeAll: vi.fn() } as never,
      provider: { refresh },
    })).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
