import { describe, expect, it, vi } from "vitest";
import { mcpToolFromCatalog } from "./tools";
import type { McpCatalogTool } from "./types";

const catalogTool: McpCatalogTool = {
  serverId: "notes-server",
  name: "write_note",
  namespacedName: "mcp__notes-server__write_note",
  description: "Write a note",
  inputSchema: { type: "object", properties: { token: { type: "string" } } },
  annotations: { destructiveHint: true },
  exposed: true,
  trusted: false,
  permissionReason: "mcp_untrusted_server",
};

describe("MCP neutral tool adapter", () => {
  it("uses a normalized MCP target and redacts approval arguments", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const tool = mcpToolFromCatalog(catalogTool, { callTool });

    const request = await tool.permission!.request({ token: "secret-value" });
    const preview = tool.permission!.preview({ token: "secret-value" });

    expect(request).toMatchObject({ capability: "mcp", target: "mcp://notes-server/write_note", normalizedTarget: "mcp://notes-server/write_note", trusted: false, destructive: true });
    expect(JSON.stringify(preview)).not.toContain("secret-value");
    await expect(tool.execute({ toolCallId: "call-1", args: { token: "secret-value" } })).resolves.toMatchObject({ isError: false });
    expect(callTool).toHaveBeenCalledWith("write_note", { token: "secret-value" }, expect.anything());
  });
});
