import { describe, expect, it } from "vitest";
import type { McpSecretReference } from "./config";
import { createMcpSecretStore, redactMcpValue } from "./secrets";

describe("MCP secret boundary", () => {
  it("resolves references in the main process and returns safe statuses", async () => {
    const store = createMcpSecretStore({
      environment: { TOKEN: "env-token" },
      secret: (key) => key === "mcp.token" ? "stored-token" : undefined,
      secretStatus: (key) => key === "mcp.token",
      oauth: (profile) => profile === "github" ? "oauth-token" : undefined,
      oauthStatus: (profile) => profile === "github",
    });
    const refs: McpSecretReference[] = [
      { source: "environment", name: "TOKEN" },
      { source: "secret", key: "mcp.token" },
      { source: "oauth", profile: "github" },
    ];

    await expect(store.resolve(refs[0])).resolves.toBe("env-token");
    expect(store.status(refs[1])).toBe("configured");
    expect(store.status({ source: "secret", key: "missing" })).toBe("missing");
    expect(store.projection(refs[2])).toEqual({ source: "oauth", key: "github", status: "configured" });
  });

  it("redacts common credentials recursively without changing ordinary text", () => {
    expect(redactMcpValue({ token: "secret-token", Authorization: "Bearer abc", nested: { password: "pw" }, text: "hello" })).toEqual({
      token: "[REDACTED]",
      Authorization: "[REDACTED]",
      nested: { password: "[REDACTED]" },
      text: "hello",
    });
    expect(redactMcpValue("ordinary text")).toBe("ordinary text");
  });
});
