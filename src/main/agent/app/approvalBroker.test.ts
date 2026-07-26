import { describe, expect, it, vi } from "vitest";
import { createApprovalBroker } from "./approvalBroker";
import { createApprovalPolicyStore } from "./approvalPolicy";
import type { ApprovalDecision, EventSinkPort } from "../ports";

function events() {
  const items: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
  const sink: EventSinkPort = { emit: (nodeId, type, payload) => items.push({ nodeId, type, payload }) };
  return { sink, items };
}

const request = {
  nodeId: "n1",
  turnId: "t1",
  toolCallId: "tc1",
  toolName: "write_file",
  target: "/tmp/a",
  preview: { title: "Write /tmp/a" },
  defaultScope: "once" as const,
};

describe("createApprovalPolicyStore", () => {
  it("consumes one-time approval once and expires node-session grants", () => {
    const policies = createApprovalPolicyStore();
    policies.grant({ nodeId: "n1", toolName: "tool", target: "a", scope: "once" });
    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "a" })).toBe(true);
    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "a" })).toBe(false);

    policies.grant({ nodeId: "n1", toolName: "tool", target: "a", scope: "node-session" });
    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "a" })).toBe(true);
    policies.clearNodeSession("n1");
    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "a" })).toBe(false);
  });

  it("requires persistent policies to match tool and normalized target", () => {
    const policies = createApprovalPolicyStore({
      isPersistentAllowed: (toolName, target) => toolName === "tool" && target === "a",
    });

    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "a" })).toBe(true);
    expect(policies.isAllowed({ nodeId: "n1", toolName: "tool", target: "b" })).toBe(false);
  });
});

describe("createApprovalBroker", () => {
  it("emits a bounded pending request and resolves a matching allow decision", async () => {
    const eventLog = events();
    const broker = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 100 }, timeoutMs: 1000 });
    const pending = broker.request(request);

    const emitted = eventLog.items[0].payload as any;
    expect(eventLog.items[0]).toMatchObject({ nodeId: "n1", type: "approval" });
    expect(emitted).toMatchObject({ requestId: expect.any(String), toolName: "write_file", expiresAt: 1100 });

    const decision: ApprovalDecision = {
      requestId: emitted.requestId,
      nodeId: "n1",
      turnId: "t1",
      toolCallId: "tc1",
      toolName: "write_file",
      action: "allow",
      scope: "once",
    };
    expect(broker.decide(decision)).toEqual({ ok: true });
    await expect(pending).resolves.toEqual(decision);
    expect(broker.decide(decision)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects stale or mismatched decisions", () => {
    const eventLog = events();
    const broker = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 100 }, timeoutMs: 1000 });
    void broker.request(request).catch(() => undefined);
    const requestId = (eventLog.items[0].payload as any).requestId;

    expect(
      broker.decide({
        requestId,
        nodeId: "other",
        turnId: "t1",
        toolCallId: "tc1",
        toolName: "write_file",
        action: "allow",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });

    broker.cancelByTurn("n1", "t1", "aborted");
    expect(
      broker.decide({
        requestId,
        nodeId: "n1",
        turnId: "t1",
        toolCallId: "tc1",
        toolName: "write_file",
        action: "allow",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("times out pending requests as denied decisions", async () => {
    vi.useFakeTimers();
    const eventLog = events();
    const broker = createApprovalBroker({ events: eventLog.sink, clock: { now: () => 100 }, timeoutMs: 10 });
    const pending = broker.request(request);
    await vi.advanceTimersByTimeAsync(11);
    await expect(pending).resolves.toMatchObject({ action: "deny", requestId: expect.any(String) });
    vi.useRealTimers();
  });
});
