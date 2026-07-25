import { describe, expect, it, vi } from "vitest";
import { createCalcTool, createNowTool, createWebFetchTool, evaluateArithmetic } from "../tools";

describe("now tool", () => {
  it("uses the injected clock", async () => {
    const tool = createNowTool({ now: () => Date.UTC(2026, 6, 24, 1, 2, 3) });
    const result = await tool.execute({ toolCallId: "now-1", args: {} });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("2026-07-24T01:02:03.000Z") });
    expect(result.details).toMatchObject({ timestamp: Date.UTC(2026, 6, 24, 1, 2, 3) });
  });
});

describe("calc tool", () => {
  it("evaluates arithmetic without JavaScript globals", async () => {
    expect(evaluateArithmetic("(2 + 3) * 4 ^ 2")).toBe(80);
    const tool = createCalcTool();
    const result = await tool.execute({ toolCallId: "calc-1", args: { expression: "10 / (2 + 3)" } });
    expect(result.content[0]).toMatchObject({ type: "text", text: "10 / (2 + 3) = 2" });
  });

  it("rejects unsupported JavaScript-like input", () => {
    expect(() => evaluateArithmetic("process.exit()")).toThrow(/Unsupported character|Expected/);
    expect(() => evaluateArithmetic("Math.max(1,2)")).toThrow(/Unsupported character/);
  });
});

describe("web_fetch tool", () => {
  it("fetches text-like content and strips html", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("<html><title>x</title><body>Hello <b>world</b></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    const tool = createWebFetchTool(fetchImpl);
    const result = await tool.execute({ toolCallId: "fetch-1", args: { url: "https://example.com" } });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Hello world") });
    expect(result.details).toMatchObject({ status: 200, contentType: "text/html" });
  });

  it("rejects non-http urls", async () => {
    const tool = createWebFetchTool();
    await expect(tool.execute({ toolCallId: "fetch-2", args: { url: "file:///tmp/a" } })).rejects.toThrow(/HTTP/);
  });
});
