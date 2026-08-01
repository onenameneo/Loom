import type { ApprovalPort, AgentHook, BlockDecision, HookToolCallContext } from "../../ports";
import type { ApprovalPolicyStore } from "../../app/approvalPolicy";
import type { AgentTool } from "../../core/tool";
import { DEFAULT_PERMISSION_CONTEXT, evaluatePermission, type PermissionContext, type PermissionReason, type SandboxMode, type ApprovalPolicy } from "../../core/permissions";

export function createApprovalGate(deps: {
  approvals: ApprovalPort;
  policies: ApprovalPolicyStore;
  getTool(nodeId: string, name: string): AgentTool | undefined;
  setAwaitingApproval(nodeId: string, turnId: string, approval: { requestId: string; toolName: string; toolCallId: string; reason?: PermissionReason; sandboxMode?: SandboxMode; approvalPolicy?: ApprovalPolicy }): boolean;
  setRunning(nodeId: string, turnId: string): boolean;
  getPermissionContext?: (nodeId: string) => Partial<PermissionContext> | undefined;
  emitPermission?: (nodeId: string, payload: unknown) => void;
}): AgentHook {
  async function onToolCall(ctx: HookToolCallContext): Promise<BlockDecision | void> {
    const tool = deps.getTool(ctx.nodeId, ctx.toolName);
    if (!tool?.approval?.required && !tool?.permission) return undefined;
    if (!ctx.turnId) return { block: true, reason: "approval unavailable" };

    const args = ctx.args as never;
    const permission = { ...DEFAULT_PERMISSION_CONTEXT, ...(deps.getPermissionContext?.(ctx.nodeId) ?? {}) };
    let target: string;
    let reason = tool.approval?.reason ?? "external_mutation";
    let preview: { title: string; description?: string; args?: unknown };
    if (tool.permission) {
      const request = await tool.permission.request(args);
      const evaluated = evaluatePermission(permission, request);
      if (evaluated.action === "allow") return undefined;
      if (evaluated.action === "deny") {
        deps.emitPermission?.(ctx.nodeId, {
          state: "denied",
          toolName: ctx.toolName,
          toolCallId: ctx.toolCallId,
          target: evaluated.normalizedTarget,
          reason: evaluated.reason ?? "permission denied",
          sandboxMode: permission.sandboxMode,
          approvalPolicy: permission.approvalPolicy,
        });
        return { block: true, reason: evaluated.reason ?? "permission denied" };
      }
      target = evaluated.normalizedTarget;
      reason = evaluated.reason ?? reason;
      preview = tool.permission.preview(args);
    } else {
      target = await tool.approval!.normalizeTarget(args);
      preview = tool.approval!.preview(args);
    }
    if (deps.policies.isAllowed({ nodeId: ctx.nodeId, toolName: ctx.toolName, target })) return undefined;
    if (tool.approval?.required && permission.approvalPolicy === "never") {
      deps.emitPermission?.(ctx.nodeId, {
        state: "denied",
        toolName: ctx.toolName,
        toolCallId: ctx.toolCallId,
        target,
        reason: "permission_escalation",
        sandboxMode: permission.sandboxMode,
        approvalPolicy: permission.approvalPolicy,
      });
      return { block: true, reason: "approval policy never" };
    }

    const pending = deps.approvals.request({
      nodeId: ctx.nodeId,
      turnId: ctx.turnId,
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
      target,
      normalizedTarget: target,
      reason,
      sandboxMode: permission.sandboxMode,
      approvalPolicy: permission.approvalPolicy,
      reviewer: "user",
      preview,
      defaultScope: tool.approval?.defaultScope ?? "once",
    });

    deps.setAwaitingApproval(ctx.nodeId, ctx.turnId, {
      requestId: pending.requestId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      reason,
      sandboxMode: permission.sandboxMode,
      approvalPolicy: permission.approvalPolicy,
    });

    const decision = await pending;
    deps.setRunning(ctx.nodeId, ctx.turnId);
    if (decision.action !== "allow") return { block: true, reason: "approval denied" };
    deps.policies.grant({
      nodeId: ctx.nodeId,
      toolName: ctx.toolName,
      target,
      scope: decision.scope ?? tool.approval?.defaultScope ?? "once",
    });
    return undefined;
  }

  return { name: "approval-gate", onToolCall };
}
