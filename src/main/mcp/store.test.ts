import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { isMcpToolExposed, loadMcpConfiguration, loadMcpConsent, removeMcpConsent, saveMcpConsent, saveMcpServerConfig } from "./store";

function writeJson(path: string, value: unknown) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
const tempRoots: string[] = [];
function tempRoot(prefix: string) { const root = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`); tempRoots.push(root); return root; }
afterEach(() => { for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("MCP global configuration store", () => {
  it("loads only the global MCP file and migrates displayName without scope", () => {
    const root = tempRoot("loom-mcp-store");
    writeJson(join(root, "home", ".loom", "mcp.json"), { version: 1, servers: { notes: { id: "notes", displayName: "Notes", scope: "project", enabled: true, transport: { type: "stdio", command: "node", args: ["server.js"] } } } });
    const loaded = loadMcpConfiguration({ homeDir: join(root, "home") });
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.servers[0]?.config.name).toBe("Notes");
    expect(loaded.servers[0]?.config).not.toHaveProperty("scope");
  });

  it("writes only the global MCP file and preserves unrelated files", () => {
    const root = tempRoot("loom-mcp-save");
    const home = join(root, "home");
    const settingsPath = join(home, ".loom", "agent", "settings.json");
    writeJson(settingsPath, { defaults: { model: { providerId: "test", modelId: "model" } } });
    saveMcpServerConfig({ homeDir: home, config: { id: "notes", name: "Notes", enabled: false, transport: { type: "stdio", command: "node", args: ["server.js"] } } });
    expect(existsSync(join(home, ".loom", "mcp.json"))).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ defaults: { model: { providerId: "test", modelId: "model" } } });
  });

  it("preserves an existing direct API key when the edit form leaves it blank", () => {
    const homeDir = tempRoot("loom-mcp-preserve-key");
    saveMcpServerConfig({ homeDir, config: { id: "remote", name: "Remote", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer keep-me" } } } });
    saveMcpServerConfig({ homeDir, preserveSensitiveHeaders: ["Authorization"], config: { id: "remote", name: "Renamed", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp" } } });
    expect(loadMcpConfiguration({ homeDir }).servers[0]?.config.transport).toMatchObject({ headers: { Authorization: "Bearer keep-me" } });
  });

  it("clears an existing direct API key when explicitly requested", () => {
    const homeDir = tempRoot("loom-mcp-clear-key");
    saveMcpServerConfig({ homeDir, config: { id: "remote", name: "Remote", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer remove-me" } } } });
    saveMcpServerConfig({ homeDir, clearSensitiveHeaders: ["Authorization"], config: { id: "remote", name: "Remote", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp" } } });
    expect(loadMcpConfiguration({ homeDir }).servers[0]?.config.transport).not.toHaveProperty("headers");
  });

  it("removes an old sensitive header when the edit changes authentication headers", () => {
    const homeDir = tempRoot("loom-mcp-switch-key");
    saveMcpServerConfig({ homeDir, config: { id: "remote", name: "Remote", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer old", "X-Trace": "trace" } } } });
    saveMcpServerConfig({ homeDir, config: { id: "remote", name: "Remote", enabled: true, transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { "X-Api-Key": "new", "X-Trace": "trace" } } } });
    expect(loadMcpConfiguration({ homeDir }).servers[0]?.config.transport).toMatchObject({ headers: { "X-Api-Key": "new", "X-Trace": "trace" } });
    expect(loadMcpConfiguration({ homeDir }).servers[0]?.config.transport).not.toHaveProperty("headers.Authorization");
  });

  it("applies deny before the global exposure mode", () => {
    const config = { version: 1 as const, id: "tools", name: "Tools", enabled: true, revision: 1, transport: { type: "stdio" as const, command: "node", args: [] }, exposure: { mode: "all" as const, allow: [], deny: ["danger_*"] }, approval: { mode: "on-request" as const, defaultScope: "once" as const } };
    const resolved = { config };
    expect(isMcpToolExposed(resolved, "read_notes")).toBe(true);
    expect(isMcpToolExposed(resolved, "danger_read")).toBe(false);
  });

  it("persists local server consent by server revision", () => {
    const homeDir = tempRoot("loom-mcp-consent");
    expect(loadMcpConsent({ homeDir })).toEqual({});
    saveMcpConsent({ homeDir, serverId: "local-tools", configRevision: 3 });
    expect(loadMcpConsent({ homeDir })).toEqual({ "local-tools": 3 });
    removeMcpConsent({ homeDir, serverId: "local-tools" });
    expect(loadMcpConsent({ homeDir })).toEqual({});
  });
});
