import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizeMemoryListResult,
  type AutoDreamStatus,
  type MemoryFilter,
  type MemoryRecord,
  type MemoryStats,
} from "./memoryDomain";

const ERROR_LIMIT = 240;
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, ERROR_LIMIT);

function statsFor(records: MemoryRecord[], issues: number): MemoryStats {
  return {
    active: records.filter((record) => record.status === "active").length,
    candidates: records.filter((record) => record.status === "candidate").length,
    archived: records.filter((record) => record.status === "archived" || record.status === "rejected").length,
    stale: records.filter((record) => record.status === "stale").length,
    conflicted: records.filter((record) => record.status === "conflicted").length,
    issues,
  };
}

export function useMemoryManagement({ projectId, enabled = true, autoDreamEnabled = enabled }: { projectId?: string; enabled?: boolean; autoDreamEnabled?: boolean }) {
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [stats, setStats] = useState<MemoryStats>({ active: 0, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [dreaming, setDreaming] = useState(false);
  const [dreamStatus, setDreamStatus] = useState<AutoDreamStatus>({ status: "idle" });

  const reload = useCallback(async () => {
    if (!window.api?.memory) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.memory.list({ projectId, includeArchived: true });
      const normalized = normalizeMemoryListResult(result);
      setRecords(normalized.records);
      setStats(statsFor(normalized.records, normalized.issues.length));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const refreshDreamStatus = useCallback(async () => {
    if (!window.api?.memory?.autodreamStatus) return;
    try {
      const status = await window.api.memory.autodreamStatus() as AutoDreamStatus | undefined;
      if (!status) return;
      setDreamStatus(status);
      setDreaming(status.status === "running");
    } catch (cause) {
      setMutationError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshDreamStatus();
    const memoryApi = window.api?.memory;
    if (!memoryApi?.onEvent) return;
    return memoryApi.onEvent((event) => {
      if (event.type === "autodream") {
        const progress = event.progress as (AutoDreamStatus & { summary?: { changed?: string[]; skipped?: string[]; failed?: unknown[] } }) | undefined;
        const summary = progress?.summary;
        setDreamStatus((current) => ({
          ...current,
          ...progress,
          ...(summary ? { changedCount: summary.changed?.length ?? 0, skippedCount: summary.skipped?.length ?? 0, failedCount: summary.failed?.length ?? 0 } : {}),
        }));
        if (progress?.phase === "completed" || progress?.phase === "failed" || progress?.phase === "cancelled") {
          setDreaming(false);
          void refreshDreamStatus();
        }
      }
      void reload();
    });
  }, [refreshDreamStatus, reload]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    if (mutating) return false;
    setMutationError(null);
    setMutating(true);
    try {
      const result = await operation();
      if (result === undefined) throw new Error("Memory record not found or no longer available.");
      await reload();
      return true;
    } catch (cause) {
      setMutationError(errorMessage(cause));
      return false;
    } finally {
      setMutating(false);
    }
  }, [mutating, reload]);

  const approve = useCallback((id: string) => mutate(() => window.api!.memory.approve(id)), [mutate]);
  const reject = useCallback((id: string, reason = "rejected from memory settings") => mutate(() => window.api!.memory.reject(id, reason)), [mutate]);
  const archive = useCallback((id: string, reason = "archived from memory settings") => mutate(() => window.api!.memory.archive(id, reason)), [mutate]);
  const forget = useCallback((id: string, reason = "forgotten from memory settings") => mutate(() => window.api!.memory.forget(id, reason)), [mutate]);
  const edit = useCallback((id: string, patch: Record<string, unknown>) => mutate(() => window.api!.memory.edit({ id, patch })), [mutate]);
  const restore = useCallback((id: string) => mutate(() => window.api!.memory.restore(id)), [mutate]);
  const purge = useCallback((id: string) => mutate(() => window.api!.memory.purge(id)), [mutate]);
  const remember = useCallback((input: Record<string, unknown>) => mutate(() => window.api!.memory.remember(input)), [mutate]);

  const runAutoDream = useCallback(async () => {
    if (!window.api?.memory || !autoDreamEnabled) return false;
    setMutationError(null);
    setDreamStatus((current) => ({ ...current, status: "checking", phase: undefined, progress: undefined }));
    try {
      const status = await window.api.memory.autodreamStatus() as AutoDreamStatus | undefined;
      if (!status) return false;
      setDreamStatus(status);
      if (status.gate && !status.gate.eligible) return false;
      setDreaming(true);
      const summary = await window.api.memory.autodreamRun() as { status?: AutoDreamStatus["status"]; changed?: string[]; skipped?: string[]; failed?: unknown[] } | undefined;
      if (summary) setDreamStatus((current) => ({ ...current, status: summary.status ?? "completed", phase: summary.status ?? "completed", progress: 1, changedCount: summary.changed?.length ?? 0, skippedCount: summary.skipped?.length ?? 0, failedCount: summary.failed?.length ?? 0 }));
      else await refreshDreamStatus();
      await reload();
      return true;
    } catch (cause) {
      setDreamStatus((current) => ({ ...current, status: "failed", phase: "failed", lastError: errorMessage(cause) }));
      setMutationError(errorMessage(cause));
      return false;
    } finally {
      setDreaming(false);
    }
  }, [autoDreamEnabled, refreshDreamStatus, reload]);

  const cancelAutoDream = useCallback(async () => {
    try {
      await window.api?.memory?.autodreamCancel();
      setDreamStatus((current) => ({ ...current, status: "cancelled", phase: "cancelled" }));
    } catch (cause) {
      setMutationError(errorMessage(cause));
    } finally {
      setDreaming(false);
    }
  }, []);

  const visibleRecords = useMemo(() => records.filter((record) => {
    if (filter === "all") return true;
    if (filter === "archived") return record.status === "archived" || record.status === "rejected";
    return record.status === filter;
  }), [filter, records]);
  const selected = records.find((record) => record.id === selectedId);
  const autoDreamDisabled = !autoDreamEnabled || dreaming || dreamStatus.status === "checking" || Boolean(dreamStatus.gate && !dreamStatus.gate.eligible);

  return {
    records, visibleRecords, stats, selected, selectedId, setSelectedId, filter, setFilter,
    loading, error, mutationError, mutating, reload,
    approve, reject, archive, forget, edit, restore, purge, remember,
    dreaming, dreamStatus, autoDreamDisabled, runAutoDream, cancelAutoDream, refreshDreamStatus,
  };
}
