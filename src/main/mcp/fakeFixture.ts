import type { McpClientFactory, McpClientLike, McpTransportLike } from "./connection";

export interface FakeMcpFixture {
  create: McpClientFactory;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  transports: McpTransportLike[];
}

/** In-memory MCP server fixture for connection, approval, and catalog tests. */
export function createFakeMcpFixture(tools: unknown[] = []): FakeMcpFixture {
  const calls: FakeMcpFixture["calls"] = [];
  const transports: McpTransportLike[] = [];
  return {
    calls,
    transports,
    create: async () => {
      const transport: McpTransportLike = { async close() {} };
      transports.push(transport);
      const client: McpClientLike = {
        async connect() {},
        async close() {},
        async listTools() { return { tools }; },
        async callTool(params) {
          calls.push({ name: params.name, arguments: params.arguments ?? {} });
          return { content: [{ type: "text", text: "fake result" }] };
        },
      };
      return { client, transport, transportKind: "stdio" as const };
    },
  };
}
