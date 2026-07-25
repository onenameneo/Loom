import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { createToolRegistry } from "./toolRuntime";
import type { ReadonlyAgentTool } from "../core/tool";
import { limitText, textResult } from "../core/tool";

const sampleTool: ReadonlyAgentTool<{ value: string }> = {
  name: "sample",
  label: "Sample",
  description: "Sample tool",
  parameters: Type.Object({ value: Type.String() }),
  readOnly: true,
  execute: async ({ args }) => textResult(args.value, { value: args.value }),
};

describe("createToolRegistry", () => {
  it("registers and lists read-only tools", () => {
    const registry = createToolRegistry([sampleTool]);
    expect(registry.list().map((t) => t.name)).toEqual(["sample"]);
    expect(registry.get("sample")).toBe(sampleTool);
  });

  it("rejects duplicate tool names", () => {
    const registry = createToolRegistry([sampleTool]);
    expect(() => registry.register(sampleTool)).toThrow(/Duplicate tool/);
  });

  it("normalizes thrown executor errors", async () => {
    const registry = createToolRegistry([
      {
        ...sampleTool,
        name: "fails",
        execute: async () => {
          throw new Error("nope");
        },
      },
    ]);
    const result = await registry.execute("fails", { toolCallId: "tc", args: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("nope") });
  });
});

describe("limitText", () => {
  it("truncates text and reports metadata", () => {
    const result = limitText("abcdef", 3);
    expect(result.text).toBe("abc");
    expect(result.truncation).toEqual({ truncated: true, originalLength: 6, limit: 3 });
  });
});
