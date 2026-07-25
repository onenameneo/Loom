import type { ClockPort } from "../ports";
import type { ReadonlyAgentTool } from "../core/tool";
import { createCalcTool } from "./calc";
import { createNowTool } from "./now";
import { createWebFetchTool } from "./webfetch";

export function createDefaultReadonlyTools(clock: ClockPort): ReadonlyAgentTool[] {
  return [createNowTool(clock), createCalcTool(), createWebFetchTool()];
}

export { createCalcTool, evaluateArithmetic } from "./calc";
export { createNowTool } from "./now";
export { createWebFetchTool } from "./webfetch";
