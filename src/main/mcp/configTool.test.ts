import { describe, expect, it, vi } from "vitest";
import { createApprovalBroker } from "../agent/app/approvalBroker";
import { createApprovalPolicyStore } from "../agent/app/approvalPolicy";
import { createApprovalGate } from "../agent/hooks/tools/approvalGate";
import type { EventSinkPort } from "../agent/ports";
import type { McpServerConfig } from "./config";
import { createMcpConfigTool } from "./configTool";

const config: McpServerConfig = {
  version: 1,
  id: "context7",
  name: "Context7",
  enabled: true,
  transport: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: { source: "environment", name: "CONTEXT7_TOKEN" } } },
  exposure: { mode: "all", allow: [], deny: [] },
  approval: { mode: "on-request", defaultScope: "once" },
  revision: 1,
};

function setup() {
  const events: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) };
  const approvals = createApprovalBroker({ events: sink, clock: { now: () => 1 } });
  const saved: unknown[] = [];
  const tool = createMcpConfigTool({ targetPath: "/home/neo/.loom/mcp.json", saveConfig: async (input) => { saved.push(input); return config; } });
  const gate = createApprovalGate({ approvals, policies: createApprovalPolicyStore(), getTool: () => tool, setAwaitingApproval: () => true, setRunning: () => true });
  return { events, approvals, saved, tool, gate };
}

describe("mcp_save_config", () => {
  it("requires the normal user approval flow before saving", async () => {
    const { events, approvals, saved, tool, gate } = setup();
    const pending = gate.onToolCall?.({ nodeId: "node-a", turnId: "turn-a", toolName: tool.name, toolCallId: "call-a", args: { config: { ...config } } });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const request = events[0]!.payload as { requestId: string; preview: { args: Record<string, unknown> } };
    expect(request.preview.args).toMatchObject({ id: "context7", transport: { type: "streamable-http", headerNames: ["Authorization"] } });
    expect(JSON.stringify(request)).not.toContain("secret-value");
    approvals.decide({ requestId: request.requestId, nodeId: "node-a", turnId: "turn-a", toolCallId: "call-a", toolName: tool.name, action: "allow", scope: "once" });
    await expect(pending).resolves.toBeUndefined();
    await tool.execute({ toolCallId: "call-a", args: { config: { ...config } } });
    expect(saved).toHaveLength(1);
  });

  it("is denied when the user configured approvalPolicy=never", async () => {
    const { events, tool } = setup();
    const gate = createApprovalGate({
      approvals: createApprovalBroker({ events: { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) }, clock: { now: () => 1 } }),
      policies: createApprovalPolicyStore(),
      getTool: () => tool,
      setAwaitingApproval: () => true,
      setRunning: () => true,
      getPermissionContext: () => ({ sandboxMode: "workspace-write", approvalPolicy: "never", networkAccess: false }),
      emitPermission: (nodeId, payload) => events.push({ nodeId, type: "permission", payload }),
    });
    await expect(gate.onToolCall?.({ nodeId: "node-a", turnId: "turn-a", toolName: tool.name, toolCallId: "call-a", args: { config: { ...config } } })).resolves.toMatchObject({ block: true });
    expect(events).toHaveLength(1);
  });
});
