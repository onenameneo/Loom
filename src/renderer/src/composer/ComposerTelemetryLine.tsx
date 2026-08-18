import type { AgentMetricTotals } from "../../../common/telemetry";

function compact(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
  if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}M`;
}

function averageTtft(metrics: AgentMetricTotals | null | undefined): string {
  if (!metrics || metrics.ttftSamples <= 0 || metrics.ttftMs < 0) return "—";
  return `${(metrics.ttftMs / metrics.ttftSamples / 1_000).toFixed(1)}s`;
}

function cacheShare(metrics: AgentMetricTotals | null | undefined): string {
  const input = metrics?.usage?.input;
  const cacheRead = metrics?.usage?.cacheRead;
  if (typeof input !== "number" || input < 0 || typeof cacheRead !== "number" || cacheRead < 0) return "—";
  const totalInput = input + cacheRead;
  if (totalInput <= 0) return "0%";
  return `${Math.round((cacheRead / totalInput) * 100)}%`;
}

export function ComposerTelemetryLine({ metrics }: { metrics?: AgentMetricTotals | null }) {
  const totals = metrics;
  const approximate = totals?.usage?.exact === false;
  const tokenPrefix = approximate ? "~" : "";
  const outputRate = typeof totals?.outputTokensPerSecond === "number" && totals.outputTokensPerSecond > 0
    ? `${Math.round(totals.outputTokensPerSecond)} tok/s`
    : "—";
  const items = [
    ["首 token 平均", averageTtft(totals)],
    ["LLM 输出速率", outputRate],
    ["缓存占比", `${tokenPrefix}${cacheShare(totals)}`],
    ["输入累计", `${tokenPrefix}${compact(totals?.usage?.input)} tok`],
    ["输出累计", `${tokenPrefix}${compact(totals?.usage?.output)} tok`],
  ];
  return (
    <div
      className="composer-telemetry"
      aria-label="当前节点累计运行指标"
      aria-live="polite"
      title="当前节点累计统计；完成新回合后刷新。缓存占比 = 缓存读取 ÷（普通输入 + 缓存读取）；LLM 输出速率 = 输出 token ÷ LLM 请求耗时（包含首 token 等待）"
    >
      {items.map(([label, value], index) => (
        <span className="composer-telemetry-item" key={`${label}-${value}`}>
          {index > 0 && <span className="composer-telemetry-divider" aria-hidden="true">|</span>}
          {label && <span className="composer-telemetry-label">{label} </span>}
          <span className="composer-telemetry-value">{value}</span>
        </span>
      ))}
    </div>
  );
}
