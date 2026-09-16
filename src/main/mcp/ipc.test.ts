import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import type { McpServerConfig } from "./config";
import { registerMcpIpc, safeProjection } from "./ipc";
import type { McpConnectionManager } from "./connection";
import { saveMcpServerConfig } from "./store";

const electronHandlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => electronHandlers.set(channel, handler),
    removeHandler: (channel: string) => electronHandlers.delete(channel),
  },
}));

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

  it("does not expose direct API keys while preserving configured status", () => {
    const direct = { ...config(), transport: { ...config().transport, headers: { Authorization: "Bearer super-secret-token" } } };
    const manager = { status: () => ({ serverId: "remote-notes", state: "stopped", transport: "streamable-http", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 1 }) } as unknown as McpConnectionManager;
    const result = safeProjection({ config: direct }, manager);

    expect(result.config.transport.headerNames).toEqual(["Authorization"]);
    expect(result.config.transport.headerValues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });

  it("returns bounded scope metadata without project roots", () => {
    const manager = { status: () => ({ serverId: "remote-notes", state: "stopped", transport: "streamable-http", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 1 }) } as unknown as McpConnectionManager;
    const result = safeProjection({ config: config(), scope: "project", projectId: "project-a", projectName: "Alpha", projectRoot: "/private/alpha", sourcePath: "/private/alpha/.loom/mcp.json", serverKey: "project:hash:remote-notes" }, manager);

    expect(result).toMatchObject({ scope: "project", projectId: "project-a", projectName: "Alpha" });
    expect(result).not.toHaveProperty("projectRoot");
    expect(result).not.toHaveProperty("serverKey");
    expect(result.sourcePath).toBe("/private/alpha/.loom/mcp.json");
  });

  it("rejects unregistered project contexts and disambiguates same-id project servers", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-mcp-ipc-"));
    const projectRoot = join(root, "alpha");
    saveMcpServerConfig({ homeDir: join(root, "home"), config: config() });
    saveMcpServerConfig({ homeDir: join(root, "home"), scope: "project", projectRoot, config: { ...config(), name: "Project notes" } });
    const sender = {};
    const manager = { status: () => ({ serverId: "remote-notes", state: "stopped", transport: "streamable-http", catalogRevision: 0, toolCount: 0, configuredSecretRefs: [], diagnostics: [], updatedAt: 1 }), async close() {}, async connect() { return undefined; }, approveConsent() {} } as unknown as McpConnectionManager;
    electronHandlers.clear();
    const unregister = registerMcpIpc({
      getWin: () => ({ webContents: sender, isDestroyed: () => false } as never),
      manager,
      homeDir: join(root, "home"),
      resolveProject: (id) => id === "project-a" ? { id, name: "Alpha", sourceRoot: projectRoot } : undefined,
    });
    const event = { sender } as never;
    const list = electronHandlers.get("mcp:list")!;
    const projectList = await list(event, { projectId: "project-a" }) as { projectId?: string; servers: Array<Record<string, unknown>> };
    expect(projectList.projectId).toBe("project-a");
    expect(projectList.servers).toHaveLength(1);
    expect(projectList.servers[0]).toMatchObject({ scope: "project", projectId: "project-a", config: { name: "Project notes" } });

    await expect(Promise.resolve().then(() => list(event, { projectId: "project-b" }))).rejects.toThrow(/registered active Project/i);
    const save = electronHandlers.get("mcp:save")!;
    const rejected = await save(event, { scope: "project", projectId: "project-b", config: config() });
    expect(rejected).toMatchObject({ ok: false });
    expect(readFileSync(join(projectRoot, ".loom", "mcp.json"), "utf8")).toContain("Project notes");
    unregister();
    ipcMain.removeHandler("mcp:list");
  });

});
