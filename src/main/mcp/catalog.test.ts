import { describe, expect, it } from "vitest";
import { discoverMcpCatalog, namespaceMcpToolName } from "./catalog";
import type { McpClientLike } from "./connection";
import type { McpServerConfig } from "./config";

const server: McpServerConfig = {
  version: 1,
  id: "notes-server",
  name: "Notes",
  enabled: true,
  transport: { type: "stdio", command: "node", args: [] },
  exposure: { mode: "all", allow: [], deny: [] },
  approval: { mode: "on-request", defaultScope: "once" },
  revision: 1,
};

describe("MCP catalog", () => {
  it("walks tools/list pagination and produces stable namespaced identities", async () => {
    const pages = [
      { tools: [{ name: "read", description: "Read notes", inputSchema: { type: "object", properties: { id: { type: "string" } } }, annotations: { readOnlyHint: true } }], nextCursor: "page-2" },
      { tools: [{ name: "write", description: "Write notes", inputSchema: { type: "object", properties: {} }, annotations: { destructiveHint: true } }] },
    ];
    let calls = 0;
    const client: McpClientLike = {
      async connect() {},
      async close() {},
      async listTools() { return pages[calls++]!; },
      async callTool() { return { content: [] }; },
      getServerCapabilities: () => ({ tools: { listChanged: true } }),
      getServerVersion: () => ({ name: "fixture", version: "1" }),
    };

    const result = await discoverMcpCatalog(server, client);

    expect(result.diagnostics).toEqual([]);
    expect(result.catalog?.tools.map((tool) => tool.namespacedName)).toEqual(["mcp__notes-server__read", "mcp__notes-server__write"]);
    expect(result.catalog?.tools[0]?.trusted).toBe(false);
    expect(result.catalog?.capabilities.toolsListChanged).toBe(true);
    expect(result.catalog?.revision).toBe(1);
  });

  it("omits duplicate, malformed, and unsupported schemas without failing the server", async () => {
    const client: McpClientLike = {
      async connect() {},
      async close() {},
      async listTools() {
        return {
          tools: [
            { name: "same", inputSchema: { type: "object" } },
            { name: "same", inputSchema: { type: "object" } },
            { name: "bad name", inputSchema: { type: "object" } },
            { name: "unsupported", inputSchema: { type: "object", oneOf: [] } },
          ],
        };
      },
      async callTool() { return { content: [] }; },
    };

    const result = await discoverMcpCatalog(server, client);

    expect(result.catalog?.tools.map((tool) => tool.name)).toEqual(["same"]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["duplicate-tool", "tool-name", "schema"]);
  });

  it("keeps namespacing pi-compatible and rejects collisions", () => {
    expect(namespaceMcpToolName("server", "tool_name")).toBe("mcp__server__tool_name");
    expect(namespaceMcpToolName("server", "bad/name")).toBeUndefined();
  });
});
