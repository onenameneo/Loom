import { describe, expect, it } from "vitest";
import type { McpConnectionHandle, McpConnectionManager } from "./connection";
import { createMcpToolProvider } from "./provider";
import type { McpResolvedServer } from "./store";
import type { McpServerConfig } from "./config";

function config(id: string, allow: string[]): McpServerConfig {
  return { version: 1, id, name: id, enabled: true, transport: { type: "stdio", command: "node", args: [] }, exposure: { mode: "allowlist", allow, deny: [] }, approval: { mode: "on-request", defaultScope: "once" }, revision: 1 };
}

describe("McpToolProvider", () => {
  it("filters global exposure and keeps a stable node snapshot until invalidated", async () => {
    const server: McpResolvedServer = { config: config("notes", ["read"]) };
    let names = ["read", "write"];
    const handle: McpConnectionHandle = { serverId: "notes", client: {} as never, transport: {} as never, transportKind: "stdio", state: "connected", async listTools() { return { tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) }; }, async callTool() { return { content: [] }; }, async close() {} };
    const manager: McpConnectionManager = { async connect() { return handle; }, approveConsent() {}, status: () => ({ serverId: "notes", state: "connected", transport: "stdio", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 0 }), async close() {}, async closeAll() {} };
    const provider = createMcpToolProvider({ manager, resolveServers: async () => [server] });
    const first = await provider.toolsFor("node-1");
    names = ["write"];
    const stable = await provider.toolsFor("node-1");
    provider.markToolsChanged("notes");
    provider.invalidate("node-1");
    const refreshed = await provider.toolsFor("node-1");
    expect(first.map((tool) => tool.name)).toEqual(["mcp_save_config", "mcp__notes__read"]);
    expect(stable.map((tool) => tool.name)).toEqual(["mcp_save_config", "mcp__notes__read"]);
    expect(refreshed.map((tool) => tool.name)).toEqual(["mcp_save_config"]);
  });
});
