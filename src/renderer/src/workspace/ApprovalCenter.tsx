import { ApprovalPrompt, type ApprovalState } from "../canvas/ApprovalPrompt";
import { useShallow } from "zustand/shallow";
import { selectPendingApprovals, useWorkspaceStore } from "./store";

export function ApprovalCenter() {
  const approvals = useWorkspaceStore(useShallow(selectPendingApprovals));
  if (!window.api?.canvas || approvals.length === 0) return null;

  async function decide(approval: ApprovalState, action: "allow" | "deny", scope?: ApprovalState["scope"]) {
    useWorkspaceStore.getState().applyApproval({ type: "remove", requestId: approval.requestId, revision: useWorkspaceStore.getState().latestApprovalRevision + 1 });
    const result = await window.api!.canvas.decideApproval({
      requestId: approval.requestId,
      nodeId: approval.nodeId,
      turnId: approval.turnId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      capability: approval.capability,
      normalizedTarget: approval.normalizedTarget,
      action,
      scope: action === "allow" ? scope ?? approval.scope : undefined,
    });
    if (!result.ok) {
      useWorkspaceStore.getState().applyApproval({ type: "upsert", request: { ...approval, revision: useWorkspaceStore.getState().latestApprovalRevision + 1 } });
      // The authoritative broker keeps the request visible until a successful decision.
      console.warn("Approval decision was not accepted", result.reason);
    }
  }

  return (
    <section className="approval-center" aria-label="Pending approvals">
      {approvals.map((request) => {
        const approval = { ...request, scope: request.defaultScope } as ApprovalState;
        return (
          <ApprovalPrompt
            key={request.requestId}
            approval={approval}
            compact
            onScopeChange={() => undefined}
            onDecision={(action, scope) => { void decide(approval, action, scope); }}
          />
        );
      })}
    </section>
  );
}
