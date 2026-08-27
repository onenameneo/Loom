/**
 * Neutral permission model shared by tools, command execution, and IPC.
 * This module is deliberately infrastructure-free so the decision semantics
 * can be tested without Electron or a real process sandbox.
 */

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "never";
export type ApprovalsReviewer = "user" | "auto-review";
export type PermissionProfileName = "suggest" | "auto-edit" | "full-auto" | "full-access";
export type PermissionRule = "ask" | "allow-in-boundary" | "allow";
export type PermissionRisk = "low" | "elevated" | "high";

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
  risk?: PermissionRisk;
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
  /** User-facing autonomy preset. The legacy fields below remain as a compatibility projection. */
  profile?: PermissionProfileName;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
  writableRoots?: string[];
  approvalsReviewer?: ApprovalsReviewer;
  commandOutputLimit?: number;
  /** A full-access adapter is still allowed to fail closed if unavailable. */
  sandboxAvailable?: boolean;
}

export interface PermissionProfileInput {
  mode?: PermissionProfileName;
  profile?: PermissionProfileName;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  networkAccess?: boolean;
  writableRoots?: string[];
  approvalsReviewer?: ApprovalsReviewer;
  commandOutputLimit?: number;
}

export interface CompiledPermissionProfile {
  mode: PermissionProfileName;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
  mutation: PermissionRule;
  command: PermissionRule;
  writableRoots?: string[];
  approvalsReviewer?: ApprovalsReviewer;
  commandOutputLimit?: number;
}

export interface PermissionDecision {
  action: "allow" | "deny" | "ask";
  risk?: PermissionRisk;
  reason?: PermissionReason;
  target: string;
  normalizedTarget: string;
}

export const DEFAULT_PERMISSION_CONTEXT: PermissionContext = {
  profile: "auto-edit",
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

export function isPermissionProfile(value: unknown): value is PermissionProfileName {
  return value === "suggest" || value === "auto-edit" || value === "full-auto" || value === "full-access";
}

function profileDefaults(mode: PermissionProfileName): Omit<CompiledPermissionProfile, "mode"> {
  switch (mode) {
    case "suggest":
      return { sandboxMode: "read-only", approvalPolicy: "on-request", networkAccess: false, mutation: "ask", command: "ask" };
    case "full-auto":
      return { sandboxMode: "workspace-write", approvalPolicy: "on-request", networkAccess: false, mutation: "allow-in-boundary", command: "allow-in-boundary" };
    case "full-access":
      return { sandboxMode: "danger-full-access", approvalPolicy: "never", networkAccess: true, mutation: "allow", command: "allow" };
    case "auto-edit":
    default:
      return { sandboxMode: "workspace-write", approvalPolicy: "on-request", networkAccess: false, mutation: "allow-in-boundary", command: "ask" };
  }
}

function legacyProfile(value: Partial<PermissionProfileInput> | undefined): PermissionProfileName | undefined {
  if (isPermissionProfile(value?.mode)) return value.mode;
  if (isPermissionProfile(value?.profile)) return value.profile;
  if (value?.sandboxMode === "read-only") return "suggest";
  if (value?.sandboxMode === "danger-full-access") return "full-access";
  if (value?.sandboxMode === "workspace-write") return "auto-edit";
  return undefined;
}

export function normalizePermissionProfile(value: Partial<PermissionProfileInput> | undefined): CompiledPermissionProfile {
  const mode = legacyProfile(value) ?? "auto-edit";
  const defaults = profileDefaults(mode);
  return {
    mode,
    ...defaults,
    // Codex's Full Access preset is an explicit no-approval mode. Ignore a
    // stale persisted policy so the profile shown in Settings matches runtime.
    approvalPolicy: mode === "full-access" ? "never" : isApprovalPolicy(value?.approvalPolicy) ? value.approvalPolicy : defaults.approvalPolicy,
    networkAccess: mode === "full-access" ? true : value?.networkAccess === true,
    writableRoots: Array.isArray(value?.writableRoots) ? value.writableRoots.filter((root): root is string => typeof root === "string") : undefined,
    approvalsReviewer: isApprovalsReviewer(value?.approvalsReviewer) ? value.approvalsReviewer : undefined,
    commandOutputLimit: typeof value?.commandOutputLimit === "number" && Number.isFinite(value.commandOutputLimit)
      ? value.commandOutputLimit
      : undefined,
  };
}

export function compilePermissionProfile(value: Partial<PermissionProfileInput> | undefined): CompiledPermissionProfile {
  return normalizePermissionProfile(value);
}

export function permissionInstructionsFor(value: Partial<PermissionProfileInput> | undefined): string {
  const profile = compilePermissionProfile(value);
  const name = profile.mode === "auto-edit" ? "Auto Edit" : profile.mode === "full-auto" ? "Full Auto" : profile.mode === "full-access" ? "Full Access" : "Suggest";
  const mutation = profile.mutation === "allow"
    ? "ordinary file edits are allowed"
    : profile.mutation === "allow-in-boundary"
      ? "ordinary file edits inside the workspace are allowed"
      : "do not modify files automatically";
  const command = profile.command === "allow"
    ? "commands are allowed"
    : profile.command === "allow-in-boundary"
      ? "commands inside the workspace are allowed"
      : profile.approvalPolicy === "never" ? "commands requiring escalation are denied" : "ask for approval before running commands";
  const network = profile.networkAccess
    ? "network access is available"
    : profile.approvalPolicy === "never" ? "network access is disabled" : "network access requires approval when requested";
  const roots = profile.writableRoots?.length ? profile.writableRoots.join(", ") : "configured Project roots";
  return [
    "## Permission profile",
    `- Effective mode: ${name}.`,
    `- ${mutation}; ${command}; ${network}.`,
    `- Writable boundary: ${roots}.`,
    ...(profile.mode === "full-access"
      ? ["- Full Access is enabled: actions run with unrestricted local access and do not show approval prompts."]
      : profile.approvalPolicy === "never"
        ? ["- Actions that require approval are denied; do not claim or imply that the model can self-approve them."]
        : []),
    "- Stay within the declared workspace and preserve bounded previews, exact targets, and expected-version checks for file mutations.",
    "- Never claim that an operation succeeded until the tool returns a successful result.",
  ].join("\n");
}

export function normalizePermissionContext(value: Partial<PermissionContext> | undefined): PermissionContext {
  const profile = normalizePermissionProfile(value);
  return {
    profile: profile.mode,
    sandboxMode: profile.sandboxMode,
    approvalPolicy: profile.approvalPolicy,
    networkAccess: profile.networkAccess,
    writableRoots: profile.writableRoots,
    approvalsReviewer: profile.approvalsReviewer,
    commandOutputLimit: profile.commandOutputLimit,
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
  const profile = compilePermissionProfile(context);
  if (request.capability === "network" && !profile.networkAccess && profile.sandboxMode !== "danger-full-access") {
    return "network_access";
  }
  if (
    (request.capability === "write" || request.capability === "delete" || request.capability === "read") &&
    profile.sandboxMode !== "danger-full-access" &&
    request.targetInWorkspace !== true
  ) {
    return "outside_workspace";
  }
  if ((request.capability === "write" || request.capability === "delete") && profile.mutation === "ask") {
    return "permission_escalation";
  }
  if (request.capability === "mcp" && request.destructive) return "mcp_side_effect";
  if (request.capability === "delete" || request.destructive) return "destructive_command";
  if (request.capability === "external-mutation") return "external_mutation";
  if (request.capability === "mcp" && request.trusted !== true) return "mcp_untrusted_server";
  if (request.capability === "permission-escalation") return "permission_escalation";
  if (request.capability === "command" && profile.sandboxMode === "read-only") return "permission_escalation";
  if (request.capability === "command" && profile.sandboxMode !== "danger-full-access" && request.targetInWorkspace !== true) {
    return "outside_workspace";
  }
  if (request.capability === "command" && request.trusted === false && context.approvalPolicy === "untrusted") return "untrusted_command";
  if (request.capability === "command" && profile.command === "ask" && request.targetInWorkspace === true && context.approvalPolicy !== "untrusted") {
    return "permission_escalation";
  }
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

  // Full Access is the Codex "danger-full-access + never" combination. It
  // intentionally bypasses approval checks for all capabilities; the only
  // fail-closed exception is an unavailable full-access adapter above.
  if (context.sandboxMode === "danger-full-access" && context.approvalPolicy === "never") {
    return { action: "allow", target: request.target, normalizedTarget: request.normalizedTarget };
  }

  const reason = reasonForBoundary(request, context);
  if (!reason) return { action: "allow", target: request.target, normalizedTarget: request.normalizedTarget };

  if (context.approvalPolicy === "never") {
    return { action: "deny", reason, target: request.target, normalizedTarget: request.normalizedTarget };
  }

  // `untrusted` asks for untrusted commands even when they are otherwise
  // inside the boundary. Other in-boundary actions remain automatic.
  return { action: "ask", reason, target: request.target, normalizedTarget: request.normalizedTarget };
}
