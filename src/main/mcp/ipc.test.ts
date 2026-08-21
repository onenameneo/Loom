import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "./config";
import { safeProjection } from "./ipc";
import type { McpConnectionManager } from "./connection";

function config(): McpServerConfig {
  return {
    version: 1,
    id: "remote-notes",
    name: "Remote notes",
    enabled: true,
    transport: {
      type: "streamable-http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: { source: "secret", key: "mcp.remote.token" } },
    },
    exposure: { mode: "allowlist", allow: ["read_*"], deny: ["delete_*"] },
    approval: { mode: "on-request", defaultScope: "once" },
    revision: 2,
  };
}

describe("MCP IPC safe projection", () => {
  it("returns editable transport metadata without secret values or client handles", () => {
    const manager = { status: () => ({ serverId: "remote-notes", state: "stopped", transport: "streamable-http", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 1 }) } as unknown as McpConnectionManager;
    const result = safeProjection({ config: config() }, manager);

    expect(result.config.transport).toMatchObject({ type: "streamable-http", url: "https://mcp.example.com/mcp", headerNames: ["Authorization"] });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
    expect(result.secrets).toEqual([{ source: "secret", key: "mcp.remote.token", status: "missing" }]);
    expect(result).not.toHaveProperty("client");
  });
});
