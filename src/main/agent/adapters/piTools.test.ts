import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../core/tool";
import { textResult } from "../core/tool";
import { adaptReadonlyToolToPi, consumePiErrorClassification } from "./piTools";

describe("adaptReadonlyToolToPi", () => {
  it("maps neutral tools to pi AgentTool shape", async () => {
    const tool: ReadonlyAgentTool<{ value: string }> = {
      name: "sample",
      label: "Sample",
      description: "Sample tool",
      parameters: Type.Object({ value: Type.String() }),
      readOnly: true,
      executionMode: "sequential",
      execute: async ({ args }) => textResult(args.value, { echoed: args.value }),
    };

    const piTool = adaptReadonlyToolToPi(tool);
    expect(piTool).toMatchObject({
      name: "sample",
      label: "Sample",
      description: "Sample tool",
      executionMode: "sequential",
    });
    expect(piTool.parameters).toBe(tool.parameters);

    const result = await piTool.execute("tc-1", { value: "ok" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
    expect(result.details).toEqual({ echoed: "ok" });
  });

  it("preserves normalized error content and details for the afterToolCall bridge", async () => {
    const tool: ReadonlyAgentTool = {
      name: "sample",
      label: "Sample",
      description: "Sample tool",
      parameters: Type.Object({}),
      readOnly: true,
      execute: async () => textResult("bad", { reason: "bad" }, true),
    };

    const piTool = adaptReadonlyToolToPi(tool);
    const result = await piTool.execute("tc-1", {});
    expect(result).toMatchObject({ content: [{ type: "text", text: "bad" }], details: { reason: "bad" } });
    expect(consumePiErrorClassification(result)).toBe(true);
    expect(result.details).toEqual({ reason: "bad" });
  });

  it("normalizes unexpected executor errors without an unbounded stack trace", async () => {
    const tool: ReadonlyAgentTool = {
      name: "sample",
      label: "Sample",
      description: "Sample tool",
      parameters: Type.Object({}),
      readOnly: true,
      execute: async () => {
        throw new Error("executor failed");
      },
    };

    const result = await adaptReadonlyToolToPi(tool).execute("tc-1", {});
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("executor failed") });
    expect(result.details).toMatchObject({ kind: "execution", processState: "failed" });
    expect(consumePiErrorClassification(result)).toBe(true);
  });
});
