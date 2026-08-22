import type { ApprovalCenterEvent, ApprovalDecision, ApprovalPort, ApprovalRequest, ClockPort, EventSinkPort, PendingApprovalDecision } from "../ports";
import { DEFAULT_PERMISSION_CONTEXT } from "../core/permissions";

interface PendingApproval {
  request: ApprovalRequest;
  timer: ReturnType<typeof setTimeout>;
  resolve(decision: ApprovalDecision): void;
}

let nextApprovalSeq = 1;

function requestId() {
  return `appr-${Date.now().toString(36)}-${nextApprovalSeq++}`;
}

export function createApprovalBroker(deps: {
  events: EventSinkPort;
  clock: ClockPort;
  timeoutMs?: number;
}): ApprovalPort {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const pending = new Map<string, PendingApproval>();
  const listeners = new Set<(event: ApprovalCenterEvent) => void>();
  let revision = 0;

  function resolvePending(item: PendingApproval, decision: ApprovalDecision) {
    clearTimeout(item.timer);
    pending.delete(item.request.requestId);
    const event: ApprovalCenterEvent = { type: "remove", requestId: item.request.requestId, revision: ++revision };
    for (const listener of listeners) listener(event);
    item.resolve(decision);
  }

  return {
    request(input) {
      const now = deps.clock.now();
      const request: ApprovalRequest = {
        ...input,
        normalizedTarget: input.normalizedTarget ?? input.target,
        reason: input.reason ?? "external_mutation",
        sandboxMode: input.sandboxMode ?? DEFAULT_PERMISSION_CONTEXT.sandboxMode,
        approvalPolicy: input.approvalPolicy ?? DEFAULT_PERMISSION_CONTEXT.approvalPolicy,
        reviewer: input.reviewer ?? "user",
        requestId: requestId(),
        createdAt: now,
        expiresAt: now + timeoutMs,
        revision: ++revision,
      };
      const promise = new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          const item = pending.get(request.requestId);
          if (!item) return;
          resolvePending(item, {
            requestId: request.requestId,
            nodeId: request.nodeId,
            turnId: request.turnId,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            action: "deny",
            scope: "once",
          });
        }, timeoutMs);
        pending.set(request.requestId, { request, timer, resolve });
      });
      const event: ApprovalCenterEvent = { type: "upsert", request };
      for (const listener of listeners) listener(event);
      deps.events.emit(request.nodeId, "approval", request);
      return Object.assign(promise, { requestId: request.requestId }) as PendingApprovalDecision;
    },

    listPending() {
      return [...pending.values()].map((item) => item.request);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    decide(decision) {
      const item = pending.get(decision.requestId);
      if (!item) return { ok: false, reason: "not_found" };
      const { request } = item;
      if (
        request.nodeId !== decision.nodeId ||
        request.turnId !== decision.turnId ||
        request.toolCallId !== decision.toolCallId ||
        request.toolName !== decision.toolName ||
        (decision.capability !== undefined && request.capability !== decision.capability) ||
        (decision.normalizedTarget !== undefined && request.normalizedTarget !== decision.normalizedTarget)
      ) {
        return { ok: false, reason: "mismatch" };
      }
      resolvePending(item, decision);
      return { ok: true };
    },

    cancelByTurn(nodeId, turnId) {
      for (const item of [...pending.values()]) {
        if (item.request.nodeId !== nodeId || item.request.turnId !== turnId) continue;
        resolvePending(item, {
          requestId: item.request.requestId,
          nodeId: item.request.nodeId,
          turnId: item.request.turnId,
          toolCallId: item.request.toolCallId,
          toolName: item.request.toolName,
          action: "deny",
          scope: "once",
        });
      }
    },

    cancelByNode(nodeId) {
      for (const item of [...pending.values()]) {
        if (item.request.nodeId !== nodeId) continue;
        resolvePending(item, {
          requestId: item.request.requestId,
          nodeId: item.request.nodeId,
          turnId: item.request.turnId,
          toolCallId: item.request.toolCallId,
          toolName: item.request.toolName,
          action: "deny",
          scope: "once",
        });
      }
    },
  };
}
