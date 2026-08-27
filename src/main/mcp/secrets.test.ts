import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpSecretReference } from "./config";
import { createMcpCredentialVault, createMcpSecretStore, redactMcpValue } from "./secrets";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

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

  it("stores managed credentials encrypted and reloads them without exposing plaintext on disk", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-mcp-secrets-"));
    tempDirs.push(home);
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
    };
    const vault = createMcpCredentialVault({ homeDir: home, safeStorage });

    await vault.set("mcp.remote.authorization", "super-secret-token");

    const filePath = join(home, ".loom", "mcp-secrets.json");
    expect(vault.isAvailable()).toBe(true);
    expect(vault.has("mcp.remote.authorization")).toBe(true);
    await expect(vault.get("mcp.remote.authorization")).resolves.toBe("super-secret-token");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).not.toContain("super-secret-token");

    const reloaded = createMcpCredentialVault({ homeDir: home, safeStorage });
    await expect(reloaded.get("mcp.remote.authorization")).resolves.toBe("super-secret-token");
    await reloaded.set("mcp.remote.authorization", "replacement-token");
    await expect(reloaded.get("mcp.remote.authorization")).resolves.toBe("replacement-token");
    await reloaded.delete("mcp.remote.authorization");
    expect(reloaded.has("mcp.remote.authorization")).toBe(false);
  });

  it("fails closed when Electron secure storage is unavailable", async () => {
    const home = await mkdtemp(join(tmpdir(), "loom-mcp-secrets-"));
    tempDirs.push(home);
    const vault = createMcpCredentialVault({
      homeDir: home,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from("should-not-be-written"),
        decryptString: () => "should-not-be-read",
      },
    });

    expect(vault.isAvailable()).toBe(false);
    await expect(vault.set("mcp.remote.authorization", "super-secret-token")).rejects.toThrow("secure storage is unavailable");
    expect(existsSync(join(home, ".loom", "mcp-secrets.json"))).toBe(false);
    const store = createMcpSecretStore({ vault });
    expect(store.status({ source: "secret", key: "mcp.remote.authorization" })).toBe("unavailable");
  });
});
