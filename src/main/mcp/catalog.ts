import type { TSchema } from "typebox";
import type { PermissionReason } from "../agent/core/permissions";
import type { McpClientLike } from "./connection";
import { MCP_SERVER_ID_PATTERN } from "./config";
import type { McpCatalog, McpCatalogTool, McpDiagnostic, McpServerCapabilities, McpToolAnnotations } from "./types";
import type { McpServerConfig } from "./config";

export type McpCatalogDiagnosticCode = "pagination" | "duplicate-tool" | "tool-name" | "schema" | "limit";

export interface McpCatalogDiagnostic {
  code: McpCatalogDiagnosticCode;
  message: string;
  toolName?: string;
}

export interface McpCatalogResult {
  catalog?: McpCatalog;
  diagnostics: McpCatalogDiagnostic[];
}

const MAX_PAGES = 64;
const MAX_TOOLS = 512;
const MAX_SCHEMA_BYTES = 128 * 1024;
const MAX_SCHEMA_DEPTH = 12;
const MAX_DESCRIPTION = 8_000;
const PI_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const UNSUPPORTED_SCHEMA_KEYS = new Set(["$ref", "oneOf", "anyOf", "allOf", "not", "if", "then", "else", "dependentSchemas"]);

function diagnostic(code: McpCatalogDiagnosticCode, message: string, toolName?: string): McpCatalogDiagnostic {
  return { code, message: message.slice(0, 500), ...(toolName ? { toolName } : {}) };
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeSchema(value: unknown, depth = 0, seen = new WeakSet<object>()): { schema?: Record<string, unknown>; reason?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { reason: "inputSchema must be an object." };
  if (depth > MAX_SCHEMA_DEPTH) return { reason: "inputSchema exceeds the supported nesting depth." };
  if (seen.has(value)) return { reason: "inputSchema contains a cycle." };
  seen.add(value);
  const source = value as Record<string, unknown>;
  if (source.type !== "object") return { reason: "inputSchema root type must be object." };
  for (const key of Object.keys(source)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) return { reason: `inputSchema uses unsupported keyword ${key}.` };
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "properties") {
      if (!child || typeof child !== "object" || Array.isArray(child)) return { reason: "inputSchema.properties must be an object." };
      const entries = Object.entries(child as Record<string, unknown>);
      if (entries.length > 200) return { reason: "inputSchema contains too many properties." };
      const properties: Record<string, unknown> = {};
      for (const [propertyName, propertySchema] of entries) {
        const normalizedProperty = normalizeSchemaNode(propertySchema, depth + 1, seen);
        if (!normalizedProperty.schema) return { reason: `property ${propertyName} is invalid: ${normalizedProperty.reason}` };
        properties[propertyName] = normalizedProperty.schema;
      }
      normalized.properties = properties;
    } else if (key === "required") {
      if (!Array.isArray(child) || !child.every((item) => typeof item === "string") || child.length > 200) return { reason: "inputSchema.required must be a bounded string array." };
      normalized.required = [...new Set(child)];
    } else {
      normalized[key] = child;
    }
  }
  seen.delete(value);
  if (jsonSize(normalized) > MAX_SCHEMA_BYTES) return { reason: "inputSchema exceeds the size limit." };
  return { schema: normalized };
}

function normalizeSchemaNode(value: unknown, depth: number, seen: WeakSet<object>): { schema?: Record<string, unknown>; reason?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { reason: "schema must be an object." };
  if (depth > MAX_SCHEMA_DEPTH) return { reason: "schema exceeds the supported nesting depth." };
  if (seen.has(value)) return { reason: "schema contains a cycle." };
  seen.add(value);
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) if (UNSUPPORTED_SCHEMA_KEYS.has(key)) return { reason: `schema uses unsupported keyword ${key}.` };
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "properties") {
      if (!child || typeof child !== "object" || Array.isArray(child)) return { reason: "schema.properties must be an object." };
      const properties: Record<string, unknown> = {};
      for (const [name, property] of Object.entries(child as Record<string, unknown>)) {
        const normalized = normalizeSchemaNode(property, depth + 1, seen);
        if (!normalized.schema) return normalized;
        properties[name] = normalized.schema;
      }
      result.properties = properties;
    } else if (key === "items") {
      const normalized = normalizeSchemaNode(child, depth + 1, seen);
      if (!normalized.schema) return normalized;
      result.items = normalized.schema;
    } else {
      result[key] = child;
    }
  }
  seen.delete(value);
  return { schema: result };
}

function normalizeAnnotations(value: unknown): McpToolAnnotations | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return {
    ...(typeof source.title === "string" ? { title: source.title.slice(0, 160) } : {}),
    ...(typeof source.readOnlyHint === "boolean" ? { readOnlyHint: source.readOnlyHint } : {}),
    ...(typeof source.destructiveHint === "boolean" ? { destructiveHint: source.destructiveHint } : {}),
    ...(typeof source.idempotentHint === "boolean" ? { idempotentHint: source.idempotentHint } : {}),
    ...(typeof source.openWorldHint === "boolean" ? { openWorldHint: source.openWorldHint } : {}),
  };
}

function capabilitiesFor(client: McpClientLike): McpServerCapabilities {
  const value = client.getServerCapabilities?.() ?? {};
  const tools = value.tools;
  const resources = value.resources;
  const prompts = value.prompts;
  const logging = value.logging;
  const objectCapability = (candidate: unknown): Record<string, unknown> => candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const version = client.getServerVersion?.();
  return {
    tools: tools !== undefined,
    toolsListChanged: objectCapability(tools).listChanged === true,
    resources: resources !== undefined,
    prompts: prompts !== undefined,
    logging: logging !== undefined,
    ...(version?.name ? { serverName: version.name.slice(0, 160) } : {}),
    ...(version?.version ? { serverVersion: version.version.slice(0, 80) } : {}),
  };
}

export function namespaceMcpToolName(serverId: string, toolName: string): string | undefined {
  if (!MCP_SERVER_ID_PATTERN.test(serverId) || !PI_TOOL_NAME.test(toolName)) return undefined;
  const namespaced = `mcp__${serverId}__${toolName}`;
  return namespaced.length <= 256 ? namespaced : undefined;
}

export async function discoverMcpCatalog(server: McpServerConfig, client: McpClientLike, options: { previousRevision?: number; now?: number } = {}): Promise<McpCatalogResult> {
  const diagnostics: McpCatalogDiagnostic[] = [];
  const tools: McpCatalogTool[] = [];
  const names = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (pageCount < MAX_PAGES && tools.length < MAX_TOOLS) {
    let page: { tools: unknown[]; nextCursor?: string };
    try {
      page = await client.listTools(cursor ? { cursor } : undefined);
    } catch (error) {
      diagnostics.push(diagnostic("pagination", error instanceof Error ? error.message : String(error)));
      break;
    }
    pageCount += 1;
    for (const raw of page.tools) {
      if (tools.length >= MAX_TOOLS) {
        diagnostics.push(diagnostic("limit", "MCP tool catalog reached its maximum size."));
        break;
      }
      if (!raw || typeof raw !== "object") {
        diagnostics.push(diagnostic("schema", "MCP tool entry must be an object."));
        continue;
      }
      const candidate = raw as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name : "";
      const namespacedName = namespaceMcpToolName(server.id, name);
      if (!namespacedName) {
        diagnostics.push(diagnostic("tool-name", "MCP tool name is not compatible with pi tool naming rules.", name || undefined));
        continue;
      }
      if (names.has(name)) {
        diagnostics.push(diagnostic("duplicate-tool", "Duplicate MCP tool name was omitted.", name));
        continue;
      }
      const normalizedSchema = normalizeSchema(candidate.inputSchema);
      if (!normalizedSchema.schema) {
        diagnostics.push(diagnostic("schema", normalizedSchema.reason ?? "MCP input schema is invalid.", name));
        continue;
      }
      names.add(name);
      const annotations = normalizeAnnotations(candidate.annotations);
      const permissionReason: PermissionReason = "mcp_untrusted_server";
      tools.push({
        serverId: server.id,
        name,
        namespacedName,
        title: typeof candidate.title === "string" ? candidate.title.slice(0, 160) : annotations?.title,
        description: typeof candidate.description === "string" ? candidate.description.slice(0, MAX_DESCRIPTION) : "MCP tool provided by an external server.",
        inputSchema: normalizedSchema.schema,
        ...(candidate.outputSchema ? { outputSchema: typeof candidate.outputSchema === "object" && !Array.isArray(candidate.outputSchema) ? candidate.outputSchema as Record<string, unknown> : undefined } : {}),
        ...(annotations ? { annotations } : {}),
        exposed: true,
        trusted: false,
        permissionReason,
      });
    }
    if (!page.nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = page.nextCursor;
  }
  if (cursor) diagnostics.push(diagnostic("pagination", "MCP tool pagination exceeded the bounded page limit."));
  return {
    catalog: {
      serverId: server.id,
      revision: (options.previousRevision ?? 0) + 1,
      tools,
      capabilities: capabilitiesFor(client),
      updatedAt: options.now ?? Date.now(),
    },
    diagnostics,
  };
}

export function asMcpToolSchema(schema: Record<string, unknown>): TSchema {
  return schema as TSchema;
}

export function catalogDiagnosticsAsMcpDiagnostics(diagnostics: McpCatalogDiagnostic[], at = Date.now()): McpDiagnostic[] {
  return diagnostics.map((item) => ({ code: item.code === "schema" ? "schema" : "discovery", message: item.message, retryable: item.code === "pagination", at }));
}
