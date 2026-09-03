import { describe, expect, it } from "vitest";
import { normalizeMcpServerConfig } from "./config";

describe("normalizeMcpServerConfig", () => {
  it("normalizes a valid stdio server and preserves only secret references", () => {
    const result = normalizeMcpServerConfig({
      id: "github",
      name: "GitHub",
      enabled: true,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_TOKEN: { source: "secret", key: "mcp.github.token" },
        },
      },
      exposure: { mode: "allowlist", allow: ["search_*"], deny: ["delete_*"] },
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toMatchObject({
      id: "github",
      transport: { type: "stdio", command: "npx" },
      exposure: { mode: "allowlist", allow: ["search_*"], deny: ["delete_*"] },
    });
  });

  it("rejects shell-shaped stdio commands and unsafe remote URLs", () => {
    const stdio = normalizeMcpServerConfig({
      id: "bad",
      transport: { type: "stdio", command: "sh -c 'curl evil'", args: [] },
    });
    const remote = normalizeMcpServerConfig({
      id: "remote",
      transport: { type: "streamable-http", url: "http://example.com/mcp" },
    });

    expect(stdio.config).toBeUndefined();
    expect(stdio.issues.map((issue) => issue.code)).toContain("stdio_command");
    expect(remote.config).toBeUndefined();
    expect(remote.issues.map((issue) => issue.code)).toContain("http_url");
  });

  it("accepts plaintext values for direct local MCP configuration", () => {
    const result = normalizeMcpServerConfig({
      id: "remote",
      name: "Remote",
      transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer plaintext" } },
    });

    expect(result.issues).toEqual([]);
    expect(result.config?.transport).toMatchObject({ headers: { Authorization: "Bearer plaintext" } });
  });

  it("accepts direct stdio environment values", () => {
    const result = normalizeMcpServerConfig({
      id: "github",
      name: "GitHub",
      transport: { type: "stdio", command: "npx", args: [], env: { GITHUB_TOKEN: "direct-token" } },
    });

    expect(result.issues).toEqual([]);
    expect(result.config?.transport).toMatchObject({ env: { GITHUB_TOKEN: "direct-token" } });
  });

  it("isolates unknown fields as diagnostics while keeping a valid entry", () => {
    const result = normalizeMcpServerConfig({
      id: "notes",
      unknown: true,
      transport: { type: "stdio", command: "node", args: ["server.js"] },
    });

    expect(result.config?.id).toBe("notes");
    expect(result.issues).toEqual([{ code: "unknown_field", path: "unknown", message: "Unknown MCP configuration field." }]);
  });
});
