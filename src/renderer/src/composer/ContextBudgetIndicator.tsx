import { useState } from "react";
import { Popover } from "radix-ui";
import type { NodeBudget } from "../env";
import { composerBudgetState } from "./contextBudget";
import { useI18n } from "../i18n/I18nProvider";

function compactTokens(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
  if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}M`;
}

function statusText(status: ReturnType<typeof composerBudgetState>["status"], t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "model-unavailable") return t("composer.contextUnavailable");
  if (status === "critical") return t("composer.contextCritical");
  if (status === "warning") return t("composer.contextWarning");
  return t("composer.contextNormal");
}

export function ContextBudgetIndicator({
  budget,
  onCompact,
  compactBusy = false,
}: {
  budget?: NodeBudget | null;
  onCompact: () => void | Promise<void>;
  compactBusy?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const state = composerBudgetState(budget);
  const label = state.percent === null ? t("composer.contextUnavailable") : `${state.percent}%`;
  const title = `${statusText(state.status, t)} · ${state.source ?? "estimated"}`;
  const circumference = 2 * Math.PI * 10;
  const dashOffset = circumference * (1 - state.progress);
  const canCompact = budget?.status === "needs-compaction" && !compactBusy;
  const modelLabel = budget?.model ? `${budget.model.providerId}/${budget.model.modelId}` : t("composer.unresolvedModel");

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`context-budget-indicator is-${state.status}`}
          aria-label={`${label}, ${title}, ${t("composer.viewBudget")}`}
          title={`${title} · ${t("composer.viewBudget")}`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <svg className="context-budget-indicator__ring" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="context-budget-indicator__track" cx="12" cy="12" r="10" />
            <circle
              className="context-budget-indicator__progress"
              cx="12"
              cy="12"
              r="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <span className="context-budget-indicator__value">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="composer-popover context-budget-popover nodrag"
          side="top"
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="context-budget-popover__title">{t("composer.currentContext")}</div>
          <div className="context-budget-popover__status" data-status={state.status}>
            <span>{statusText(state.status, t)}</span>
            <small>{state.source ?? "estimated"}</small>
          </div>
          <dl className="context-budget-popover__grid">
            <dt>{t("composer.model")}</dt><dd>{modelLabel}</dd>
            <dt>{t("composer.contextWindow")}</dt><dd>{compactTokens(budget?.contextWindowTokens)} tok</dd>
            <dt>{t("composer.reserveOutput")}</dt><dd>{compactTokens(budget?.reserveOutputTokens)} tok</dd>
            <dt>{t("composer.safeInput")}</dt><dd>{compactTokens(budget?.safeInputBudget)} tok</dd>
            <dt>{t("composer.projectedInput")}</dt><dd>{compactTokens(budget?.projectedInputTokens)} tok · {label}</dd>
            <dt>{t("composer.fixedContext")}</dt><dd>{compactTokens(budget?.fixedContextTokens)} tok</dd>
            <dt>{t("composer.localTail")}</dt><dd>{compactTokens(budget?.nodeLocalTailBudgetTokens)} tok</dd>
            {typeof budget?.overflowTokens === "number" && budget.overflowTokens > 0 && (
              <><dt>{t("composer.overflow")}</dt><dd>{compactTokens(budget.overflowTokens)} tok</dd></>
            )}
          </dl>
          {budget?.diagnostic && <div className="context-budget-popover__diagnostic">{budget.diagnostic}</div>}
          {budget?.preview && (
            <div className="context-budget-popover__attachments">
              {t("composer.attachments", { images: budget.preview.images, files: budget.preview.files, skills: budget.preview.skills })}
            </div>
          )}
          {budget?.preview?.errors?.length ? (
            <div className="context-budget-popover__diagnostic" role="alert">
              {budget.preview.errors.map((error) => `@${error.path}：${error.message}`).join("；")}
            </div>
          ) : null}
          {canCompact && (
            <button type="button" className="context-budget-popover__compact" onClick={() => void onCompact()}>
              {t("composer.compactContext")}
            </button>
          )}
          {compactBusy && <div className="context-budget-popover__diagnostic">{t("composer.compacting")}</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
