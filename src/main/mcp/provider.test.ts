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

  it("does not reuse a node snapshot after switching project context", async () => {
    const projects = ["project-a", "project-b"];
    let active = projects[0];
    const server: McpResolvedServer = { config: config("notes", ["*"]), scope: "project", projectId: active, projectRoot: `/workspace/${active}`, serverKey: `project:${active}:notes` };
    let connects = 0;
    const connectionKeys: string[] = [];
    const handle: McpConnectionHandle = { serverId: "notes", client: {} as never, transport: {} as never, transportKind: "stdio", state: "connected", async listTools() { return { tools: [{ name: active === "project-a" ? "read-a" : "read-b", inputSchema: { type: "object" } }] }; }, async callTool() { return { content: [] }; }, async close() {} };
    const manager: McpConnectionManager = { async connect(_server, options) { connects += 1; if (options?.serverKey) connectionKeys.push(options.serverKey); return handle; }, approveConsent() {}, status: () => ({ serverId: "notes", state: "connected", transport: "stdio", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 0 }), async close() {}, async closeAll() {} };
    const provider = createMcpToolProvider({
      manager,
      resolveProjectContext: () => ({ projectId: active, projectRoot: `/workspace/${active}` }),
      resolveServers: async () => [{ ...server, projectId: active, projectRoot: `/workspace/${active}`, serverKey: `project:${active}:notes` }],
    });

    expect((await provider.toolsFor("node-1")).map((tool) => tool.name)).toContain("mcp__notes__read-a");
    active = projects[1];
    expect((await provider.toolsFor("node-1")).map((tool) => tool.name)).toContain("mcp__notes__read-b");
    expect(connects).toBe(4);
    expect(new Set(connectionKeys)).toEqual(new Set(["project:project-a:notes", "project:project-b:notes"]));
  });
});
