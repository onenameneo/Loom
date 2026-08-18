import { useState } from "react";
import { Popover } from "radix-ui";
import type { NodeBudget } from "../env";
import { composerBudgetState } from "./contextBudget";

function compactTokens(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
  if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}M`;
}

function statusText(status: ReturnType<typeof composerBudgetState>["status"]): string {
  if (status === "model-unavailable") return "上下文不可用";
  if (status === "critical") return "上下文超出安全范围";
  if (status === "warning") return "接近上下文上限";
  return "上下文正常";
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
  const [open, setOpen] = useState(false);
  const state = composerBudgetState(budget);
  const label = state.percent === null ? "上下文不可用" : `${state.percent}%`;
  const title = `${statusText(state.status)} · ${state.source ?? "estimated"}`;
  const circumference = 2 * Math.PI * 10;
  const dashOffset = circumference * (1 - state.progress);
  const canCompact = budget?.status === "needs-compaction" && !compactBusy;
  const modelLabel = budget?.model ? `${budget.model.providerId}/${budget.model.modelId}` : "未解析模型";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`context-budget-indicator is-${state.status}`}
          aria-label={`${label}，${title}，查看上下文预算详情`}
          title={`${title} · 点击查看详情`}
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
          <div className="context-budget-popover__title">当前上下文</div>
          <div className="context-budget-popover__status" data-status={state.status}>
            <span>{statusText(state.status)}</span>
            <small>{state.source ?? "estimated"}</small>
          </div>
          <dl className="context-budget-popover__grid">
            <dt>模型</dt><dd>{modelLabel}</dd>
            <dt>Context window</dt><dd>{compactTokens(budget?.contextWindowTokens)} tok</dd>
            <dt>预留输出</dt><dd>{compactTokens(budget?.reserveOutputTokens)} tok</dd>
            <dt>安全输入</dt><dd>{compactTokens(budget?.safeInputBudget)} tok</dd>
            <dt>预计输入</dt><dd>{compactTokens(budget?.projectedInputTokens)} tok · {label}</dd>
            <dt>固定上下文</dt><dd>{compactTokens(budget?.fixedContextTokens)} tok</dd>
            <dt>本地 tail</dt><dd>{compactTokens(budget?.nodeLocalTailBudgetTokens)} tok</dd>
            {typeof budget?.overflowTokens === "number" && budget.overflowTokens > 0 && (
              <><dt>溢出</dt><dd>{compactTokens(budget.overflowTokens)} tok</dd></>
            )}
          </dl>
          {budget?.diagnostic && <div className="context-budget-popover__diagnostic">{budget.diagnostic}</div>}
          {budget?.preview && (
            <div className="context-budget-popover__attachments">
              待发送：{budget.preview.images} 张图片 · {budget.preview.files} 个文件 · {budget.preview.skills} 个 Skill
            </div>
          )}
          {budget?.preview?.errors?.length ? (
            <div className="context-budget-popover__diagnostic" role="alert">
              {budget.preview.errors.map((error) => `@${error.path}：${error.message}`).join("；")}
            </div>
          ) : null}
          {canCompact && (
            <button type="button" className="context-budget-popover__compact" onClick={() => void onCompact()}>
              压缩上下文
            </button>
          )}
          {compactBusy && <div className="context-budget-popover__diagnostic">压缩中…</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
