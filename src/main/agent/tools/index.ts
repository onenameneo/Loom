import type { ClockPort } from "../ports";
import type { ReadonlyAgentTool } from "../core/tool";
import { createCalcTool } from "./calc";
import { createNowTool } from "./now";
import { createProjectFileTools, createProjectMutationTools } from "./projectFiles";
import { createWebFetchTool } from "./webfetch";
export { createCommandTool } from "./command";

export function createDefaultReadonlyTools(clock: ClockPort): ReadonlyAgentTool[] {
  return [createNowTool(clock), createCalcTool(), createWebFetchTool()];
}

export { createCalcTool, evaluateArithmetic } from "./calc";
export { createNowTool } from "./now";
export { createProjectFileTools, createProjectMutationTools } from "./projectFiles";
export { createWebFetchTool } from "./webfetch";
export { createWriteTodosTool } from "./write-todos";
