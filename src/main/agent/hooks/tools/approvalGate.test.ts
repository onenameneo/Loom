import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { createApprovalBroker } from "../../app/approvalBroker";
import { createApprovalPolicyStore } from "../../app/approvalPolicy";
import { createApprovalGate } from "./approvalGate";
import type { EventSinkPort } from "../../ports";
import type { AgentTool, ReadonlyAgentTool } from "../../core/tool";

function events() {
  const items: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => items.push({ nodeId, type, payload }) };
  return { sink, items };
}

const approvedTool: ReadonlyAgentTool<{ path: string }> = {
  name: "write_file",
  label: "Write file",
  description: "Writes a file",
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  permission: {
    request: (args) => ({ capability: "external-mutation", target: args.path, normalizedTarget: args.path, targetInWorkspace: false }),
    preview: (args) => ({ title: `Write ${args.path}`, args }),
  },
  execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
};

const mutationTool: AgentTool<{ path: string; content: string }> = {
  name: "write",
  label: "Write Project File",
  description: "Writes a Project file",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  permission: {
    request: async (args) => ({ capability: "write", target: args.path, normalizedTarget: `root:${args.path}`, targetInWorkspace: false }),
    preview: (args) => ({ title: `Write ${args.path}`, args: { path: args.path, contentLength: args.content.length } }),
  },
  execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
};

describe("createApprovalGate", () => {
  it("does not block tools without approval requirements", async () => {
    const eventLog = events();
    const gate = createApprovalGate({
      approvals: createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } }),
      policies: createApprovalPolicyStore(),
      getTool: () => undefined,
      setAwaitingApproval: () => false,
      setRunning: () => false,
    });

    await expect(gate.onToolCall?.({ nodeId: "n1", turnId: "t1", toolName: "now", toolCallId: "tc", args: {} })).resolves.toBeUndefined();
    expect(eventLog.items).toEqual([]);
  });

  it("allows a valid approval decision and records its scope", async () => {
    const eventLog = events();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const policies = createApprovalPolicyStore();
    const gate = createApprovalGate({
      approvals,
      policies,
      getTool: () => approvedTool,
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    const pending = gate.onToolCall?.({ nodeId: "n1", turnId: "t1", toolName: "write_file", toolCallId: "tc", args: { path: "/tmp/a" } });
    await vi.waitFor(() => expect(eventLog.items).toHaveLength(1));
    const emitted = eventLog.items[0].payload as any;
    approvals.decide({
      requestId: emitted.requestId,
      nodeId: "n1",
      turnId: "t1",
      toolCallId: "tc",
      toolName: "write_file",
      action: "allow",
      scope: "node-session",
    });

    await expect(pending).resolves.toBeUndefined();
    expect(policies.isAllowed({ nodeId: "n1", toolName: "write_file", target: "/tmp/a" })).toBe(true);
  });

  it("blocks deny decisions and requests missing turn identity", async () => {
    const eventLog = events();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const gate = createApprovalGate({
      approvals,
      policies: createApprovalPolicyStore(),
      getTool: () => approvedTool,
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    await expect(
      gate.onToolCall?.({ nodeId: "n1", toolName: "write_file", toolCallId: "tc0", args: { path: "/tmp/a" } }),
    ).resolves.toEqual({ block: true, reason: "approval unavailable" });

    const pending = gate.onToolCall?.({ nodeId: "n1", turnId: "t1", toolName: "write_file", toolCallId: "tc", args: { path: "/tmp/a" } });
    await vi.waitFor(() => expect(eventLog.items).toHaveLength(1));
    const emitted = eventLog.items[0].payload as any;
    approvals.decide({
      requestId: emitted.requestId,
      nodeId: "n1",
      turnId: "t1",
      toolCallId: "tc",
      toolName: "write_file",
      action: "deny",
    });

    await expect(pending).resolves.toEqual({ block: true, reason: "approval denied" });
  });

  it("uses node-scoped dynamic mutation tools and redacts approval previews", async () => {
    const eventLog = events();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const gate = createApprovalGate({
      approvals,
      policies: createApprovalPolicyStore(),
      getTool: (nodeId, name) => (nodeId === "n1" && name === "write" ? mutationTool : undefined),
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    const pending = gate.onToolCall?.({
      nodeId: "n1",
      turnId: "t1",
      toolName: "write",
      toolCallId: "tc",
      args: { path: "a.md", content: "secret full content" },
    });
    await vi.waitFor(() => expect(eventLog.items).toHaveLength(1));
    const request = eventLog.items[0].payload as any;
    expect(request.target).toBe("root:a.md");
    expect(JSON.stringify(request.preview)).not.toContain("secret full content");

    approvals.decide({
      requestId: request.requestId,
      nodeId: "n1",
      turnId: "t1",
      toolCallId: "tc",
      toolName: "write",
      action: "deny",
    });
    await expect(pending).resolves.toEqual({ block: true, reason: "approval denied" });
  });

  it("keeps persistent approvals scoped to one normalized target", async () => {
    const eventLog = events();
    const approvals = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } });
    const policies = createApprovalPolicyStore({
      isPersistentAllowed: (toolName, target) => toolName === "write" && target === "root:a.md",
      grantPersistent: () => undefined,
    });
    const gate = createApprovalGate({
      approvals,
      policies,
      getTool: () => mutationTool,
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    await expect(
      gate.onToolCall?.({
        nodeId: "n1",
        turnId: "t1",
        toolName: "write",
        toolCallId: "tc1",
        args: { path: "a.md", content: "x" },
      }),
    ).resolves.toBeUndefined();
    expect(eventLog.items).toEqual([]);

    const pending = gate.onToolCall?.({
      nodeId: "n1",
      turnId: "t1",
      toolName: "write",
      toolCallId: "tc2",
      args: { path: "b.md", content: "x" },
    });
    await vi.waitFor(() => expect(eventLog.items).toHaveLength(1));
    approvals.decide({
      requestId: (eventLog.items[0].payload as any).requestId,
      nodeId: "n1",
      turnId: "t1",
      toolCallId: "tc2",
      toolName: "write",
      action: "allow",
      scope: "once",
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it("does not open an approval prompt under never policy", async () => {
    const eventLog = events();
    const gate = createApprovalGate({
      approvals: createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } }),
      policies: createApprovalPolicyStore(),
      getTool: () => mutationTool,
      getPermissionContext: () => ({ sandboxMode: "workspace-write", approvalPolicy: "never", networkAccess: false }),
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    await expect(gate.onToolCall?.({
      nodeId: "n1",
      turnId: "t1",
        toolName: "write",
      toolCallId: "tc",
      args: { path: "a.md", content: "x" },
    })).resolves.toEqual({ block: true, reason: "outside_workspace" });
    expect(eventLog.items).toHaveLength(0);
  });

  it("does not open an approval prompt for MCP in full access", async () => {
    const eventLog = events();
    const mcpTool = {
      ...mutationTool,
      name: "mcp__neo-site__list_posts",
      permission: {
        request: async () => ({
          capability: "mcp" as const,
          target: "mcp://neo-site/list_posts",
          normalizedTarget: "mcp://neo-site/list_posts",
          trusted: false,
          destructive: true,
        }),
        preview: () => ({ title: "List posts" }),
      },
    };
    const gate = createApprovalGate({
      approvals: createApprovalBroker({ events: eventLog.sink, clock: { now: () => 1 } }),
      policies: createApprovalPolicyStore(),
      getTool: () => mcpTool,
      getPermissionContext: () => ({ profile: "full-access", sandboxMode: "danger-full-access", approvalPolicy: "on-request", networkAccess: true }),
      setAwaitingApproval: () => true,
      setRunning: () => true,
    });

    await expect(gate.onToolCall?.({
      nodeId: "n1",
      turnId: "t1",
      toolName: mcpTool.name,
      toolCallId: "tc-mcp",
      args: {},
    })).resolves.toBeUndefined();
    expect(eventLog.items).toHaveLength(0);
  });
});
