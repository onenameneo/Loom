import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_CONTEXT,
  compilePermissionProfile,
  evaluatePermission,
  normalizePermissionContext,
  normalizePermissionProfile,
  permissionInstructionsFor,
} from "./permissions";

const inside = { target: "src/index.ts", normalizedTarget: "project:src/index.ts", targetInWorkspace: true };
const outside = { target: "/tmp/result.txt", normalizedTarget: "path:/tmp/result.txt", targetInWorkspace: false };

describe("permission policy", () => {
  it("normalizes a Codex-style auto-edit profile", () => {
    expect(normalizePermissionProfile({ mode: "auto-edit" })).toMatchObject({
      mode: "auto-edit",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      networkAccess: false,
    });
  });

  it("maps legacy full access settings to the full-access profile", () => {
    expect(normalizePermissionContext({ sandboxMode: "danger-full-access" })).toMatchObject({
      profile: "full-access",
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  it("makes full access a no-approval profile even when stale approval data remains", () => {
    expect(normalizePermissionProfile({ mode: "full-access", approvalPolicy: "on-request" })).toMatchObject({
      mode: "full-access",
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      networkAccess: true,
    });
  });

  it("compiles profile behavior without forcing ordinary mutations through approval", () => {
    expect(compilePermissionProfile({ mode: "auto-edit" })).toMatchObject({
      mutation: "allow-in-boundary",
      command: "ask",
    });
    expect(compilePermissionProfile({ mode: "full-auto" })).toMatchObject({
      mutation: "allow-in-boundary",
      command: "allow-in-boundary",
    });
    expect(compilePermissionProfile({ mode: "full-access" })).toMatchObject({
      mutation: "allow",
      command: "allow",
    });
  });

  it("allows an in-boundary edit under auto-edit", () => {
    expect(evaluatePermission({ profile: "auto-edit" }, { capability: "write", ...inside })).toMatchObject({ action: "allow" });
  });

  it("allows an external edit under full-access", () => {
    expect(evaluatePermission({ profile: "full-access" }, { capability: "write", ...outside })).toMatchObject({ action: "allow" });
  });

  it("asks for an in-boundary command under auto-edit", () => {
    expect(evaluatePermission({ profile: "auto-edit" }, {
      capability: "command",
      target: "pnpm test",
      normalizedTarget: "command:pnpm",
      trusted: true,
      targetInWorkspace: true,
    })).toMatchObject({ action: "ask", reason: "permission_escalation" });
  });

  it("generates model instructions from the effective profile", () => {
    expect(permissionInstructionsFor({ mode: "full-access" })).toContain("Full Access");
    expect(permissionInstructionsFor({ mode: "full-access" })).toContain("ordinary file edits are allowed");
    expect(permissionInstructionsFor({ mode: "full-access" })).toContain("do not show approval prompts");
    expect(permissionInstructionsFor({ mode: "auto-edit" })).toContain("ask for approval before running commands");
    expect(permissionInstructionsFor({ mode: "suggest" })).toContain("do not modify files automatically");
    expect(permissionInstructionsFor({ mode: "auto-edit", approvalPolicy: "never" })).toContain("Actions that require approval are denied");
  });

  it("allows in-workspace writes in the default workspace preset", () => {
    expect(evaluatePermission(DEFAULT_PERMISSION_CONTEXT, { capability: "write", ...inside })).toMatchObject({
      action: "allow",
    });
  });

  it("asks before a workspace escape under on-request", () => {
    expect(evaluatePermission(DEFAULT_PERMISSION_CONTEXT, { capability: "write", ...outside })).toMatchObject({
      action: "ask",
      reason: "outside_workspace",
    });
  });

  it("denies an unapproved workspace escape under never", () => {
    expect(evaluatePermission({ ...DEFAULT_PERMISSION_CONTEXT, approvalPolicy: "never" }, { capability: "write", ...outside })).toMatchObject({
      action: "deny",
      reason: "outside_workspace",
    });
  });

  it("asks for untrusted commands under untrusted policy", () => {
    expect(
      evaluatePermission({ ...DEFAULT_PERMISSION_CONTEXT, approvalPolicy: "untrusted" }, {
        capability: "command",
        target: "pnpm test",
        normalizedTarget: "command:pnpm",
        trusted: false,
        targetInWorkspace: true,
      }),
    ).toMatchObject({ action: "ask", reason: "untrusted_command" });
  });

  it("keeps trusted commands automatic when they stay in the boundary", () => {
    expect(evaluatePermission({ ...DEFAULT_PERMISSION_CONTEXT, approvalPolicy: "untrusted" }, {
      capability: "command",
      target: "pnpm test",
      normalizedTarget: "command:pnpm",
      trusted: true,
      targetInWorkspace: true,
    })).toMatchObject({ action: "allow" });
  });

  it("asks for network access when network is disabled", () => {
    expect(evaluatePermission(DEFAULT_PERMISSION_CONTEXT, {
      capability: "network",
      target: "https://example.com",
      normalizedTarget: "network:example.com",
    })).toMatchObject({ action: "ask", reason: "network_access" });
  });

  it("asks for untrusted MCP tools and fails closed under never", () => {
    const request = {
      capability: "mcp" as const,
      target: "mcp://github/search",
      normalizedTarget: "mcp://github/search",
      trusted: false,
    };
    expect(evaluatePermission(DEFAULT_PERMISSION_CONTEXT, request)).toMatchObject({ action: "ask", reason: "mcp_untrusted_server" });
    expect(evaluatePermission({ ...DEFAULT_PERMISSION_CONTEXT, approvalPolicy: "never" }, request)).toMatchObject({ action: "deny", reason: "mcp_untrusted_server" });
  });

  it("allows network in full access mode", () => {
    expect(evaluatePermission({ sandboxMode: "danger-full-access", approvalPolicy: "never", networkAccess: false }, {
      capability: "network",
      target: "https://example.com",
      normalizedTarget: "network:example.com",
    })).toMatchObject({ action: "allow" });
  });

  it("allows an MCP tool in full access without an approval request", () => {
    expect(evaluatePermission({ profile: "full-access" }, {
      capability: "mcp",
      target: "mcp://neo-site/list_posts",
      normalizedTarget: "mcp://neo-site/list_posts",
      trusted: false,
      destructive: true,
    })).toMatchObject({ action: "allow" });
  });

  it("does not auto-allow commands in read-only mode", () => {
    expect(evaluatePermission({ ...DEFAULT_PERMISSION_CONTEXT, sandboxMode: "read-only" }, {
      capability: "command",
      target: "python -c ...",
      normalizedTarget: "command:python",
      trusted: true,
      targetInWorkspace: true,
    })).toMatchObject({ action: "ask", reason: "permission_escalation" });
  });

  it("fails closed for malformed context values", () => {
    expect(normalizePermissionContext({ sandboxMode: "invalid" as never, approvalPolicy: "invalid" as never })).toEqual(
      DEFAULT_PERMISSION_CONTEXT,
    );
    expect(evaluatePermission({ sandboxMode: "invalid" as never, approvalPolicy: "never" }, { capability: "write", ...outside })).toMatchObject({
      action: "deny",
      reason: "outside_workspace",
    });
  });

  it("does not let never override an unavailable full-access adapter", () => {
    expect(evaluatePermission({ sandboxMode: "danger-full-access", approvalPolicy: "never", sandboxAvailable: false }, {
      capability: "write",
      ...outside,
    })).toMatchObject({ action: "deny", reason: "sandbox_unavailable" });
  });
});
