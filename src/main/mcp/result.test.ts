import { describe, expect, it } from "vitest";
import { adaptMcpToolResult } from "./result";

describe("MCP result adapter", () => {
  it("preserves bounded text and image content and retains resource links as metadata", () => {
    const result = adaptMcpToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "Zm9v", mimeType: "image/png" },
        { type: "resource_link", uri: "https://example.com/doc", name: "Doc", description: "External doc" },
      ],
      structuredContent: { token: "should be redacted" },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "hello" }, { type: "image", data: "Zm9v", mimeType: "image/png" }]);
    expect(result.details).toMatchObject({ resourceLinks: [{ uri: "https://example.com/doc", name: "Doc" }], structuredContent: { token: "[REDACTED]" } });
  });

  it("normalizes errors and truncates oversized content", () => {
    const result = adaptMcpToolResult({ isError: true, content: [{ type: "text", text: "x".repeat(100) }] }, { maxTextBytes: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text.length).toBeLessThanOrEqual(10);
    expect(result.details).toMatchObject({ truncated: true });
  });
});
