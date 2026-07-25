import { Type } from "typebox";
import type { ClockPort } from "../../ports";
import type { ReadonlyAgentTool } from "../../core/tool";
import { textResult } from "../../core/tool";

export function createNowTool(clock: ClockPort): ReadonlyAgentTool<Record<string, never>, { timestamp: number; iso: string }> {
  return {
    name: "now",
    label: "Now",
    description: "Return the current timestamp and ISO time.",
    parameters: Type.Object({}),
    readOnly: true,
    execute: async () => {
      const timestamp = clock.now();
      const iso = new Date(timestamp).toISOString();
      return textResult(`Current time: ${iso}`, { timestamp, iso });
    },
  };
}
