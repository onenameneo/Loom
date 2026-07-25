import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../core/tool";
import { textResult } from "../core/tool";
import { adaptReadonlyToolToPi } from "./piTools";

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

  it("throws for normalized tool errors so pi marks the tool result as error", async () => {
    const tool: ReadonlyAgentTool = {
      name: "sample",
      label: "Sample",
      description: "Sample tool",
      parameters: Type.Object({}),
      readOnly: true,
      execute: async () => textResult("bad", { reason: "bad" }, true),
    };

    const piTool = adaptReadonlyToolToPi(tool);
    await expect(piTool.execute("tc-1", {})).rejects.toThrow("bad");
  });
});
