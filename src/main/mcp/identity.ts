import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { McpServerConfig } from "./config";

export type McpScope = "global" | "project";

export function projectIdentity(projectRoot: string): string {
  return createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 32);
}

export function createMcpServerKey(scope: McpScope, serverId: string, projectRoot?: string): string {
  return scope === "project" ? `project:${projectIdentity(projectRoot ?? "")}:${serverId}` : `global:${serverId}`;
}

export function resolvedMcpServerKey(server: { config: McpServerConfig; scope?: McpScope; projectRoot?: string; serverKey?: string }): string {
  return server.serverKey ?? createMcpServerKey(server.scope ?? "global", server.config.id, server.projectRoot);
}
