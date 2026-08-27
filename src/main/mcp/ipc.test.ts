import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpServerConfig } from "./config";
import { saveMcpServerWithCredential, safeProjection } from "./ipc";
import { createMcpCredentialVault } from "./secrets";
import type { McpConnectionManager } from "./connection";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

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

  it("coordinates managed Bearer storage without persisting or returning the token", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-mcp-ipc-"));
    tempDirs.push(home);
    const vault = createMcpCredentialVault({
      homeDir: home,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
      },
    });
    const request = {
      version: 1,
      id: "remote-notes",
      name: "Remote notes",
      enabled: true,
      transport: {
        type: "streamable-http" as const,
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: { source: "secret" as const, key: "mcp.remote-notes.authorization" } },
      },
      exposure: { mode: "all" as const, allow: [], deny: [] },
      approval: { mode: "on-request" as const, defaultScope: "once" as const },
      revision: 1,
    };

    const result = await saveMcpServerWithCredential({ homeDir: home, config: request, bearerToken: "super-secret-token", vault });

    expect(result.transport).toMatchObject({ headers: { Authorization: { source: "secret", key: "mcp.remote-notes.authorization" } } });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
    expect(readFileSync(join(home, ".loom", "mcp.json"), "utf8")).not.toContain("super-secret-token");
    await expect(vault.get("mcp.remote-notes.authorization")).resolves.toBe("super-secret-token");
  });

  it("refuses managed credential saves when secure storage is unavailable", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-mcp-ipc-"));
    tempDirs.push(home);
    const vault = createMcpCredentialVault({
      homeDir: home,
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(""), decryptString: () => "" },
    });
    const request = {
      version: 1,
      id: "remote-notes",
      name: "Remote notes",
      enabled: true,
      transport: { type: "streamable-http" as const, url: "https://mcp.example.com/mcp", headers: { Authorization: { source: "secret" as const, key: "mcp.remote-notes.authorization" } } },
      exposure: { mode: "all" as const, allow: [], deny: [] },
      approval: { mode: "on-request" as const, defaultScope: "once" as const },
      revision: 1,
    };

    await expect(saveMcpServerWithCredential({ homeDir: home, config: request, bearerToken: "super-secret-token", vault })).rejects.toThrow("secure storage is unavailable");
  });

  it("rolls back a newly stored credential when MCP config persistence fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-mcp-ipc-"));
    tempDirs.push(home);
    await mkdir(join(home, ".loom"), { recursive: true });
    await mkdir(join(home, ".loom", "mcp.json"));
    const vault = createMcpCredentialVault({
      homeDir: home,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
      },
    });
    const request = {
      version: 1,
      id: "remote-notes",
      name: "Remote notes",
      enabled: true,
      transport: { type: "streamable-http" as const, url: "https://mcp.example.com/mcp", headers: { Authorization: { source: "secret" as const, key: "mcp.remote-notes.authorization" } } },
      exposure: { mode: "all" as const, allow: [], deny: [] },
      approval: { mode: "on-request" as const, defaultScope: "once" as const },
      revision: 1,
    };

    await expect(saveMcpServerWithCredential({ homeDir: home, config: request, bearerToken: "super-secret-token", vault })).rejects.toThrow();
    expect(vault.has("mcp.remote-notes.authorization")).toBe(false);
  });
});
