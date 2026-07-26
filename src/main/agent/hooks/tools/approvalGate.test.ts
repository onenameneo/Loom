import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { createApprovalBroker } from "../../app/approvalBroker";
import { createApprovalPolicyStore } from "../../app/approvalPolicy";
import { createApprovalGate } from "./approvalGate";
import type { EventSinkPort } from "../../ports";
import type { ReadonlyAgentTool } from "../../core/tool";

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
  approval: {
    required: true,
    defaultScope: "once",
    normalizeTarget: (args) => args.path,
    preview: (args) => ({ title: `Write ${args.path}`, args }),
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
});
