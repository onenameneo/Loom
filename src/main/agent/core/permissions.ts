/**
 * Neutral permission model shared by tools, command execution, and IPC.
 * This module is deliberately infrastructure-free so the decision semantics
 * can be tested without Electron or a real process sandbox.
 */

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "never";
export type ApprovalsReviewer = "user" | "auto-review";

export type PermissionCapability =
  | "read"
  | "write"
  | "delete"
  | "network"
  | "external-mutation"
  | "mcp"
  | "permission-escalation"
  | "command";

export type PermissionReason =
  | "outside_workspace"
  | "network_access"
  | "destructive_command"
  | "external_mutation"
  | "mcp_side_effect"
  | "mcp_untrusted_server"
  | "permission_escalation"
  | "untrusted_command"
  | "sandbox_unavailable";

export interface PermissionRequest {
  capability: PermissionCapability;
  target: string;
  /** Canonical target used for approval policy persistence. */
  normalizedTarget: string;
  /** True when the action is known to be safe inside the active boundary. */
  trusted?: boolean;
  /** Project roots that define the automatic workspace boundary. */
  workspaceRoots?: string[];
  /** Whether the normalized target is already inside a configured root. */
  targetInWorkspace?: boolean;
  /** Whether this request is a known high-risk mutation. */
  destructive?: boolean;
}

export interface PermissionContext {
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
  /** A full-access adapter is still allowed to fail closed if unavailable. */
  sandboxAvailable?: boolean;
}

export interface PermissionDecision {
  action: "allow" | "deny" | "ask";
  reason?: PermissionReason;
  target: string;
  normalizedTarget: string;
}

export interface PermissionPreview {
  title: string;
  description?: string;
  args?: unknown;
}

export interface PermissionRequestEnvelope extends PermissionRequest {
  requestId: string;
  toolName: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  reviewer: ApprovalsReviewer;
  reason: PermissionReason;
  preview: PermissionPreview;
}

export const DEFAULT_PERMISSION_CONTEXT: PermissionContext = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  networkAccess: false,
  sandboxAvailable: true,
};

export function isSandboxMode(value: unknown): value is SandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

export function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return value === "untrusted" || value === "on-request" || value === "never";
}

export function isApprovalsReviewer(value: unknown): value is ApprovalsReviewer {
  return value === "user" || value === "auto-review";
}

export function normalizePermissionContext(value: Partial<PermissionContext> | undefined): PermissionContext {
  return {
    sandboxMode: isSandboxMode(value?.sandboxMode) ? value!.sandboxMode : DEFAULT_PERMISSION_CONTEXT.sandboxMode,
    approvalPolicy: isApprovalPolicy(value?.approvalPolicy) ? value!.approvalPolicy : DEFAULT_PERMISSION_CONTEXT.approvalPolicy,
    networkAccess: value?.networkAccess === true,
    sandboxAvailable: value?.sandboxAvailable !== false,
  };
}

function denyIfUnavailable(context: PermissionContext, request: PermissionRequest): PermissionDecision | undefined {
  if (context.sandboxMode !== "danger-full-access" || context.sandboxAvailable !== false) return undefined;
  return {
    action: "deny",
    reason: "sandbox_unavailable",
    target: request.target,
    normalizedTarget: request.normalizedTarget,
  };
}

function reasonForBoundary(request: PermissionRequest, context: PermissionContext): PermissionReason | undefined {
  if (request.capability === "network" && !context.networkAccess && context.sandboxMode !== "danger-full-access") {
    return "network_access";
  }
  if (
    (request.capability === "write" || request.capability === "delete" || request.capability === "read") &&
    context.sandboxMode !== "danger-full-access" &&
    request.targetInWorkspace !== true
  ) {
    return "outside_workspace";
  }
  if (request.capability === "mcp" && request.destructive) return "mcp_side_effect";
  if (request.capability === "delete" || request.destructive) return "destructive_command";
  if (request.capability === "external-mutation") return "external_mutation";
  if (request.capability === "mcp" && request.trusted !== true) return "mcp_untrusted_server";
  if (request.capability === "permission-escalation") return "permission_escalation";
  if (request.capability === "command" && context.sandboxMode === "read-only") return "permission_escalation";
  if (request.capability === "command" && context.sandboxMode !== "danger-full-access" && request.targetInWorkspace !== true) {
    return "outside_workspace";
  }
  if (request.capability === "command" && request.trusted === false && context.approvalPolicy === "untrusted") return "untrusted_command";
  return undefined;
}

/**
 * Decide whether an action can proceed, must ask, or must be denied.
 * Approval policy never expands the sandbox: `never` converts an otherwise
 * required approval into a deny, while an explicit allow can be handled by a
 * higher-level executor that temporarily grants the requested capability.
 */
export function evaluatePermission(
  contextInput: Partial<PermissionContext> | undefined,
  request: PermissionRequest,
): PermissionDecision {
  const context = normalizePermissionContext(contextInput);
  const unavailable = denyIfUnavailable(context, request);
  if (unavailable) return unavailable;

  const reason = reasonForBoundary(request, context);
  if (!reason) return { action: "allow", target: request.target, normalizedTarget: request.normalizedTarget };

  if (context.approvalPolicy === "never") {
    return { action: "deny", reason, target: request.target, normalizedTarget: request.normalizedTarget };
  }

  // `untrusted` asks for untrusted commands even when they are otherwise
  // inside the boundary. Other in-boundary actions remain automatic.
  return { action: "ask", reason, target: request.target, normalizedTarget: request.normalizedTarget };
}
