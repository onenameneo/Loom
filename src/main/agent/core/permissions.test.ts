import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_CONTEXT,
  evaluatePermission,
  normalizePermissionContext,
} from "./permissions";

const inside = { target: "src/index.ts", normalizedTarget: "project:src/index.ts", targetInWorkspace: true };
const outside = { target: "/tmp/result.txt", normalizedTarget: "path:/tmp/result.txt", targetInWorkspace: false };

describe("permission policy", () => {
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
