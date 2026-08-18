import type { NodeBudget } from "../env";

export type ComposerBudgetStatus = "normal" | "warning" | "critical" | "model-unavailable";

export interface ComposerBudgetState {
  percent: number | null;
  progress: number;
  status: ComposerBudgetStatus;
  source?: NodeBudget["source"];
}

export function composerBudgetState(budget: NodeBudget | null | undefined): ComposerBudgetState {
  const source = budget?.source;
  const safeInputBudget = budget?.safeInputBudget ?? 0;
  if (!budget || budget.status === "model-unavailable" || !Number.isFinite(safeInputBudget) || safeInputBudget <= 0) {
    return { percent: null, progress: 0, status: "model-unavailable", source };
  }
  const projected = Number.isFinite(budget.projectedInputTokens) ? Math.max(0, budget.projectedInputTokens ?? 0) : 0;
  const percent = Math.round((projected / safeInputBudget) * 100);
  const status: ComposerBudgetStatus = budget.status === "fixed-context-overflow" || percent >= 100
    ? "critical"
    : budget.status === "needs-compaction" || percent >= 80
      ? "warning"
      : "normal";
  return { percent, progress: Math.min(1, Math.max(0, percent / 100)), status, source };
}
