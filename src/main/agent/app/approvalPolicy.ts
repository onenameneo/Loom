import type { ApprovalScope } from "../ports";

export interface ApprovalPolicyStore {
  isAllowed(arg: { nodeId: string; toolName: string; target: string }): boolean;
  grant(arg: { nodeId: string; toolName: string; target: string; scope: ApprovalScope }): void;
  clearNodeSession(nodeId: string): void;
}

export interface PersistentApprovalPolicyPort {
  isPersistentAllowed(toolName: string, target: string): boolean;
  grantPersistent?(toolName: string, target: string): void;
}

function key(toolName: string, target: string) {
  return `${toolName}\u0000${target}`;
}

export function createApprovalPolicyStore(persistent?: PersistentApprovalPolicyPort): ApprovalPolicyStore {
  const once = new Set<string>();
  const nodeSession = new Map<string, Set<string>>();

  return {
    isAllowed({ nodeId, toolName, target }) {
      const policyKey = key(toolName, target);
      if (once.delete(`${nodeId}\u0000${policyKey}`)) return true;
      if (nodeSession.get(nodeId)?.has(policyKey)) return true;
      return Boolean(persistent?.isPersistentAllowed(toolName, target));
    },

    grant({ nodeId, toolName, target, scope }) {
      const policyKey = key(toolName, target);
      if (scope === "once") once.add(`${nodeId}\u0000${policyKey}`);
      else if (scope === "node-session") {
        const grants = nodeSession.get(nodeId) ?? new Set<string>();
        grants.add(policyKey);
        nodeSession.set(nodeId, grants);
      } else {
        persistent?.grantPersistent?.(toolName, target);
      }
    },

    clearNodeSession(nodeId) {
      nodeSession.delete(nodeId);
      for (const item of [...once]) {
        if (item.startsWith(`${nodeId}\u0000`)) once.delete(item);
      }
    },
  };
}
