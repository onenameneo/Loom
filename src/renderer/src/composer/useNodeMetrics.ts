import { useCallback, useEffect, useState } from "react";
import type { AgentMetricTotals } from "../../../common/telemetry";

export function useNodeMetrics(nodeId: string) {
  const [metrics, setMetrics] = useState<AgentMetricTotals | null>(null);

  const refresh = useCallback(async () => {
    const metricsApi = window.api?.canvas?.metrics;
    if (!metricsApi) return;
    setMetrics((await metricsApi(nodeId)) ?? null);
  }, [nodeId]);

  useEffect(() => {
    setMetrics(null);
    void refresh();
  }, [refresh]);

  return { metrics, refresh };
}
