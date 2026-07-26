import type { ApprovalPort, AgentHook, BlockDecision, HookToolCallContext } from "../../ports";
import type { ApprovalPolicyStore } from "../../app/approvalPolicy";
import type { ReadonlyAgentTool } from "../../core/tool";

export function createApprovalGate(deps: {
  approvals: ApprovalPort;
  policies: ApprovalPolicyStore;
  getTool(name: string): ReadonlyAgentTool | undefined;
  setAwaitingApproval(nodeId: string, turnId: string, approval: { requestId: string; toolName: string; toolCallId: string }): boolean;
  setRunning(nodeId: string, turnId: string): boolean;
}): AgentHook {
  async function onToolCall(ctx: HookToolCallContext): Promise<BlockDecision | void> {
    const tool = deps.getTool(ctx.toolName);
    if (!tool?.approval?.required) return undefined;
    if (!ctx.turnId) return { block: true, reason: "approval unavailable" };

    const args = ctx.args as never;
    const target = tool.approval.normalizeTarget(args);
    if (deps.policies.isAllowed({ nodeId: ctx.nodeId, toolName: ctx.toolName, target })) return undefined;

    const pending = deps.approvals.request({
      nodeId: ctx.nodeId,
      turnId: ctx.turnId,
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
      target,
      preview: tool.approval.preview(args),
      defaultScope: tool.approval.defaultScope ?? "once",
    });

    deps.setAwaitingApproval(ctx.nodeId, ctx.turnId, {
      requestId: pending.requestId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
    });

    const decision = await pending;
    deps.setRunning(ctx.nodeId, ctx.turnId);
    if (decision.action !== "allow") return { block: true, reason: "approval denied" };
    deps.policies.grant({
      nodeId: ctx.nodeId,
      toolName: ctx.toolName,
      target,
      scope: decision.scope ?? tool.approval.defaultScope ?? "once",
    });
    return undefined;
  }

  return { name: "approval-gate", onToolCall };
}
