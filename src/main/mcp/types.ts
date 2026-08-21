import type { PermissionReason } from "../agent/core/permissions";
import type { McpServerConfig, McpSecretReference } from "./config";

export type McpConnectionState = "disabled" | "pending-consent" | "connecting" | "connected" | "degraded" | "failed" | "stopped";

export type McpDiagnosticCode =
  | "configuration"
  | "missing-secret"
  | "consent-required"
  | "initialization"
  | "discovery"
  | "transport"
  | "timeout"
  | "server-exit"
  | "schema"
  | "security";

export interface McpDiagnostic {
  code: McpDiagnosticCode;
  message: string;
  retryable: boolean;
  at: number;
}

export interface McpServerCapabilities {
  tools: boolean;
  toolsListChanged: boolean;
  resources: boolean;
  prompts: boolean;
  logging: boolean;
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpCatalogTool {
  serverId: string;
  name: string;
  namespacedName: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  exposed: boolean;
  trusted: boolean;
  permissionReason: PermissionReason;
}

export interface McpCatalog {
  serverId: string;
  revision: number;
  tools: McpCatalogTool[];
  capabilities: McpServerCapabilities;
  updatedAt: number;
}

export interface McpServerRuntimeStatus {
  serverId: string;
  state: McpConnectionState;
  transport: McpServerConfig["transport"]["type"];
  catalogRevision: number;
  toolCount: number;
  configuredSecretRefs: McpSecretReference[];
  diagnostics: McpDiagnostic[];
  consentRevision?: number;
  updatedAt: number;
}

export type McpSecretStatus = "configured" | "missing" | "expired" | "unavailable";

export interface McpSecretStatusProjection {
  source: McpSecretReference["source"];
  key: string;
  status: McpSecretStatus;
}

export interface McpServerSafeProjection {
  config: Omit<McpServerConfig, "transport"> & {
    transport: Pick<McpServerConfig["transport"], "type"> & {
      displayTarget: string;
      command?: string;
      args?: string[];
      cwd?: string;
      environmentNames?: string[];
      inheritedEnvironmentNames?: string[];
      url?: string;
      headerNames?: string[];
      headerValues?: Array<{ name: string; value: string }>;
      credentialReferences?: Array<{ name: string; source: "environment" | "secret" | "oauth"; identifier: string }>;
      privilegeWarning?: string;
    };
  };
  runtime: McpServerRuntimeStatus & {
    tools?: Array<{ name: string; title?: string; readOnly: boolean; destructive: boolean; exposed: boolean }>;
  };
  secrets: McpSecretStatusProjection[];
}

export interface McpConfigSnapshot {
  revision: number;
  servers: McpServerSafeProjection[];
  diagnostics: McpDiagnostic[];
}

export interface McpConnectionConsent {
  serverId: string;
  configRevision: number;
  command?: string;
  args?: string[];
  cwd?: string;
  environmentNames: string[];
  privilegeWarning: string;
}
