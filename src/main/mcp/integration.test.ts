import { describe, expect, it, vi } from "vitest";
import { createApprovalBroker } from "../agent/app/approvalBroker";
import { createApprovalPolicyStore } from "../agent/app/approvalPolicy";
import { createApprovalGate } from "../agent/hooks/tools/approvalGate";
import type { EventSinkPort } from "../agent/ports";
import { mcpToolFromCatalog } from "./tools";
import { createFakeMcpFixture } from "./fakeFixture";
import type { McpCatalogTool } from "./types";

const catalogTool: McpCatalogTool = {
  serverId: "notes",
  name: "write_note",
  namespacedName: "mcp__notes__write_note",
  description: "Write a note.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  exposed: true,
  trusted: false,
  permissionReason: "mcp_untrusted_server",
  annotations: { destructiveHint: true },
};

function eventSink() {
  const events: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => events.push({ nodeId, type, payload }) };
  return { sink, events };
}

describe("MCP pi-agent approval integration", () => {
  it("pauses before tools/call and resumes only after an allow decision", async () => {
    const fixture = createFakeMcpFixture();
    const tool = mcpToolFromCatalog(catalogTool, fixtureCaller(fixture));
    const eventLog = eventSink();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const gate = createApprovalGate({ approvals, policies: createApprovalPolicyStore(), getTool: () => tool, setAwaitingApproval: () => true, setRunning: () => true });

    const pending = gate.onToolCall?.({ nodeId: "node-a", turnId: "turn-a", toolName: tool.name, toolCallId: "call-a", args: { text: "hello" } });
    await vi.waitFor(() => expect(eventLog.events).toHaveLength(1));
    const request = eventLog.events[0]!.payload as { requestId: string };
    expect(request.requestId).toBeTruthy();
    expect(JSON.stringify(eventLog.events[0])).toContain("mcp://notes/write_note");
    approvals.decide({ requestId: request.requestId, nodeId: "node-a", turnId: "turn-a", toolCallId: "call-a", toolName: tool.name, action: "allow", scope: "once" });
    await expect(pending).resolves.toBeUndefined();

    const result = await tool.execute({ toolCallId: "call-a", args: { text: "hello" } });
    expect(result.isError).not.toBe(true);
  });

  it("blocks denied MCP calls before the server receives them", async () => {
    const fixture = createFakeMcpFixture();
    const tool = mcpToolFromCatalog(catalogTool, fixtureCaller(fixture));
    const eventLog = eventSink();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const gate = createApprovalGate({ approvals, policies: createApprovalPolicyStore(), getTool: () => tool, setAwaitingApproval: () => true, setRunning: () => true });
    const pending = gate.onToolCall?.({ nodeId: "node-a", turnId: "turn-a", toolName: tool.name, toolCallId: "call-a", args: { text: "secret" } });
    await vi.waitFor(() => expect(eventLog.events).toHaveLength(1));
    const request = eventLog.events[0]!.payload as { requestId: string };
    approvals.decide({ requestId: request.requestId, nodeId: "node-a", turnId: "turn-a", toolCallId: "call-a", toolName: tool.name, action: "deny" });
    await expect(pending).resolves.toEqual({ block: true, reason: "approval denied" });
    expect(fixture.calls).toHaveLength(0);
  });
});

function fixtureCaller(fixture: ReturnType<typeof createFakeMcpFixture>) {
  return {
    callTool: async (name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      const { client } = await fixture.create({ server: {} as never, transportKind: "stdio" });
      return client.callTool({ name, arguments: args }, options);
    },
  };
}
