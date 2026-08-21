import type { ToolContent, ToolResult } from "../agent/core/tool";
import { redactMcpValue } from "./secrets";

export interface McpResourceLinkMetadata {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResultDetails {
  source: "mcp";
  truncated: boolean;
  originalItemCount: number;
  resourceLinks: McpResourceLinkMetadata[];
  embeddedResources: Array<{ uri?: string; mimeType?: string }>;
  ignoredItemCount: number;
  structuredContent?: unknown;
}

export interface McpResultLimits {
  maxItems?: number;
  maxTextBytes?: number;
  maxImageBytes?: number;
  maxResourceLinks?: number;
}

const DEFAULT_LIMITS: Required<McpResultLimits> = {
  maxItems: 32,
  maxTextBytes: 32 * 1024,
  maxImageBytes: 4 * 1024 * 1024,
  maxResourceLinks: 32,
};

function boundedText(text: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { value: text, truncated: false };
  let value = text.slice(0, maxBytes);
  while (Buffer.byteLength(value, "utf8") > maxBytes) value = value.slice(0, -1);
  return { value, truncated: true };
}

export function adaptMcpToolResult(raw: unknown, limitsInput: McpResultLimits = {}): ToolResult<McpResultDetails> {
  const limits = { ...DEFAULT_LIMITS, ...limitsInput };
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawContent = Array.isArray(source.content) ? source.content : [];
  const content: ToolContent[] = [];
  const resourceLinks: McpResourceLinkMetadata[] = [];
  const embeddedResources: Array<{ uri?: string; mimeType?: string }> = [];
  let truncated = false;
  let ignoredItemCount = 0;

  for (const item of rawContent.slice(0, limits.maxItems)) {
    if (!item || typeof item !== "object") {
      ignoredItemCount += 1;
      continue;
    }
    const candidate = item as Record<string, unknown>;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const bounded = boundedText(candidate.text, limits.maxTextBytes);
      content.push({ type: "text", text: bounded.value });
      truncated ||= bounded.truncated;
      continue;
    }
    if (candidate.type === "image" && typeof candidate.data === "string" && typeof candidate.mimeType === "string") {
      if (Buffer.byteLength(candidate.data, "utf8") > limits.maxImageBytes) {
        ignoredItemCount += 1;
        truncated = true;
      } else {
        content.push({ type: "image", data: candidate.data, mimeType: candidate.mimeType.slice(0, 128) });
      }
      continue;
    }
    if (candidate.type === "resource_link" && typeof candidate.uri === "string") {
      if (resourceLinks.length < limits.maxResourceLinks) {
        resourceLinks.push({
          uri: candidate.uri.slice(0, 2048),
          ...(typeof candidate.name === "string" ? { name: candidate.name.slice(0, 160) } : {}),
          ...(typeof candidate.description === "string" ? { description: candidate.description.slice(0, 500) } : {}),
          ...(typeof candidate.mimeType === "string" ? { mimeType: candidate.mimeType.slice(0, 128) } : {}),
        });
      } else {
        truncated = true;
      }
      continue;
    }
    if (candidate.type === "resource") {
      const resource = candidate.resource;
      const resourceRecord = resource && typeof resource === "object" ? resource as Record<string, unknown> : {};
      embeddedResources.push({
        ...(typeof resourceRecord.uri === "string" ? { uri: resourceRecord.uri.slice(0, 2048) } : {}),
        ...(typeof resourceRecord.mimeType === "string" ? { mimeType: resourceRecord.mimeType.slice(0, 128) } : {}),
      });
      continue;
    }
    ignoredItemCount += 1;
  }
  if (rawContent.length > limits.maxItems) {
    ignoredItemCount += rawContent.length - limits.maxItems;
    truncated = true;
  }

  const details: McpResultDetails = {
    source: "mcp",
    truncated,
    originalItemCount: rawContent.length,
    resourceLinks,
    embeddedResources,
    ignoredItemCount,
    ...(source.structuredContent !== undefined ? { structuredContent: redactMcpValue(source.structuredContent) } : {}),
  };
  return {
    content: content.length ? content : [{ type: "text", text: source.isError === true ? "MCP tool returned an error without text content." : "MCP tool returned no displayable content." }],
    details,
    isError: source.isError === true,
  };
}

export function mcpErrorResult(error: unknown): ToolResult<McpResultDetails> {
  const message = error instanceof Error ? error.message : String(error);
  const result = adaptMcpToolResult({ isError: true, content: [{ type: "text", text: message }] });
  return { ...result, isError: true };
}
