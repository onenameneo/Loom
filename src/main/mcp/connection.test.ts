import { describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "./config";
import { createMcpConnectionManager, type McpClientLike, type McpTransportLike } from "./connection";

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { version: 1, id: "local-tools", name: "Local tools", enabled: true, transport: { type: "stdio", command: "node", args: ["server.mjs"], cwd: "/tmp", env: { TOKEN: { source: "environment", name: "TOKEN" } } }, exposure: { mode: "all", allow: [], deny: [] }, approval: { mode: "on-request", defaultScope: "once" }, revision: 1, ...overrides };
}
function fakeClient(): McpClientLike & { connected: boolean; closed: boolean } {
  return { connected: false, closed: false, async connect() { this.connected = true; }, async close() { this.closed = true; }, async listTools() { return { tools: [] }; }, async callTool() { return { content: [] }; } };
}
function fakeTransport(): McpTransportLike { return { async close() {} }; }

describe("McpConnectionManager", () => {
  it("requires local consent before creating a global client", async () => {
    const create = vi.fn(async () => ({ client: fakeClient(), transport: fakeTransport(), transportKind: "stdio" as const }));
    const manager = createMcpConnectionManager({ create, requestConsent: async () => false });
    const result = await manager.connect(server());
    expect(result).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(manager.status("local-tools").state).toBe("pending-consent");
  });

  it("owns one global connection and reuses it", async () => {
    const create = vi.fn(async () => ({ client: fakeClient(), transport: fakeTransport(), transportKind: "stdio" as const }));
    const manager = createMcpConnectionManager({ create, requestConsent: async () => true });
    const first = await manager.connect(server());
    const same = await manager.connect(server());
    expect(first).toBe(same);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails with a bounded timeout and records a retryable diagnostic", async () => {
    const create = vi.fn(async () => ({ client: { ...fakeClient(), async connect() { await new Promise(() => {}); } }, transport: fakeTransport(), transportKind: "stdio" as const }));
    const manager = createMcpConnectionManager({ create, requestConsent: async () => true, timeoutMs: 5 });
    await expect(manager.connect(server())).rejects.toThrow("timed out");
    expect(manager.status("local-tools").state).toBe("failed");
    expect(manager.status("local-tools").diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "timeout", retryable: true })]));
  });

  it("cancels a hanging startup and closes created resources", async () => {
    const client = fakeClient();
    const close = vi.fn(async () => { client.closed = true; });
    const create = vi.fn(async () => ({ client: { ...client, connect: async () => await new Promise<void>(() => {}), close }, transport: { ...fakeTransport(), close }, transportKind: "stdio" as const }));
    const manager = createMcpConnectionManager({ create, requestConsent: async () => true, timeoutMs: 100 });
    const controller = new AbortController();
    const pending = manager.connect(server(), { signal: controller.signal });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(close).toHaveBeenCalled();
  });

  it("marks a crash degraded and performs bounded reconnect", async () => {
    vi.useFakeTimers();
    try {
      const transports: McpTransportLike[] = [];
      const create = vi.fn(async () => { const transport: McpTransportLike = { async close() {} }; transports.push(transport); return { client: fakeClient(), transport, transportKind: "stdio" as const }; });
      const manager = createMcpConnectionManager({ create, requestConsent: async () => true, reconnectBaseMs: 5, maxReconnectAttempts: 1 });
      await manager.connect(server());
      transports[0]!.onclose?.();
      expect(manager.status("local-tools").state).toBe("degraded");
      await vi.advanceTimersByTimeAsync(5);
      expect(create).toHaveBeenCalledTimes(2);
      expect(manager.status("local-tools").state).toBe("connected");
    } finally { vi.useRealTimers(); }
  });
});
