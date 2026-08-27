export type McpTransportType = "stdio" | "streamable-http";
export type McpConnectionState = "disabled" | "pending-consent" | "connecting" | "connected" | "degraded" | "failed" | "stopped";

export interface McpSafeServerDto {
  config: {
    version: 1;
    id: string;
    name: string;
    enabled: boolean;
    exposure: { mode: "allowlist" | "all"; allow: string[]; deny: string[] };
    approval: { mode: "on-request" | "always" | "never"; defaultScope: "once" | "node-session" | "persistent" };
    revision: number;
    transport: {
      type: McpTransportType;
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
  runtime: {
    serverId: string;
    state: McpConnectionState;
    transport: McpTransportType;
    catalogRevision: number;
    toolCount: number;
    diagnostics: Array<{ code: string; message: string; retryable: boolean; at: number }>;
    tools?: Array<{ name: string; title?: string; readOnly: boolean; destructive: boolean; exposed: boolean }>;
    updatedAt: number;
  };
  secrets: Array<{ source: "environment" | "secret" | "oauth"; key: string; status: "configured" | "missing" | "expired" | "unavailable" }>;
}

export interface McpSettingsSnapshot {
  servers: McpSafeServerDto[];
  diagnostics: Array<{ code: string; path: string; message: string }>;
  revision: number;
  managedCredentialStorage?: "available" | "unavailable";
}

export type McpConfigInput = Record<string, unknown>;
export interface McpSaveRequest {
  config: McpConfigInput;
  bearerToken?: string;
  clearManagedBearer?: boolean;
}
export interface McpSaveResult {
  ok: boolean;
  config?: McpConfigInput;
  issues?: Array<{ code: string; path: string; message: string }>;
}
