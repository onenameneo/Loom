import { MemoryStore } from "./storage";
import type { MemoryRecord } from "./types";

export const AUTODREAM_MIN_INTERVAL_MS = 24 * 60 * 60_000;
export const AUTODREAM_MIN_SESSIONS = 5;
export const AUTODREAM_SCAN_THROTTLE_MS = 10 * 60_000;

export type AutoDreamPhase = "idle" | "orient" | "gather" | "consolidate" | "prune" | "completed" | "failed" | "cancelled";

export interface AutoDreamState {
  version: 1;
  newSessions: number;
  lastRunAt?: number;
  lastScanAt?: number;
  phase?: AutoDreamPhase;
  status?: "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  lastError?: string;
  changedCount?: number;
  skippedCount?: number;
  failedCount?: number;
}

export interface AutoDreamProgress {
  phase: AutoDreamPhase;
  progress: number;
  changedCount: number;
  skippedCount: number;
  failedCount: number;
  error?: string;
}

export interface AutoDreamGateResult {
  eligible: boolean;
  reason: "disabled" | "interval" | "sessions" | "throttled" | "locked" | "ready";
  nextEligibleAt?: number;
}

export interface AutoDreamRunSummary {
  status: "completed" | "failed" | "cancelled";
  changed: string[];
  archived: string[];
  skipped: string[];
  failed: Array<{ id?: string; error: string }>;
}

export interface MaintenanceProposal {
  replacement?: { description: string; content: string; type?: MemoryRecord["type"] };
  sources?: string[];
}

export interface AutoDreamMaintenanceAgent {
  consolidate(records: MemoryRecord[]): Promise<MaintenanceProposal[]>;
}

export function checkAutoDreamGates(state: AutoDreamState, options: { enabled: boolean; now: number; lockAvailable?: boolean }): AutoDreamGateResult {
  if (!options.enabled) return { eligible: false, reason: "disabled" };
  if (state.lastRunAt !== undefined && options.now - state.lastRunAt < AUTODREAM_MIN_INTERVAL_MS) return { eligible: false, reason: "interval", nextEligibleAt: state.lastRunAt + AUTODREAM_MIN_INTERVAL_MS };
  if ((state.newSessions ?? 0) < AUTODREAM_MIN_SESSIONS) return { eligible: false, reason: "sessions" };
  if (state.lastScanAt !== undefined && options.now - state.lastScanAt < AUTODREAM_SCAN_THROTTLE_MS) return { eligible: false, reason: "throttled", nextEligibleAt: state.lastScanAt + AUTODREAM_SCAN_THROTTLE_MS };
  if (options.lockAvailable === false) return { eligible: false, reason: "locked" };
  return { eligible: true, reason: "ready" };
}

export class AutoDreamService {
  private cancelled = false;

  constructor(private readonly store: MemoryStore, private readonly now: () => number = Date.now, private readonly agent?: AutoDreamMaintenanceAgent) {}

  cancel(): void {
    this.cancelled = true;
  }

  async canRun(enabled: boolean): Promise<AutoDreamGateResult> {
    const state = await this.store.readOperationalState<AutoDreamState>({ version: 1, newSessions: 0 });
    return checkAutoDreamGates(state, { enabled, now: this.now() });
  }

  async run(enabled: boolean, onProgress?: (progress: AutoDreamProgress) => void): Promise<AutoDreamRunSummary | undefined> {
    const state = await this.store.readOperationalState<AutoDreamState>({ version: 1, newSessions: 0 });
    const gate = checkAutoDreamGates(state, { enabled, now: this.now() });
    if (!gate.eligible) return undefined;
    if (!(await this.store.acquireLock(this.now()))) return undefined;
    this.cancelled = false;
    const summary: AutoDreamRunSummary = { status: "completed", changed: [], archived: [], skipped: [], failed: [] };
    const emit = (phase: AutoDreamPhase, progress: number) => onProgress?.({ phase, progress, changedCount: summary.changed.length, skippedCount: summary.skipped.length, failedCount: summary.failed.length });
    try {
      await this.store.writeOperationalState({ ...state, status: "running", phase: "orient", lastScanAt: this.now() });
      emit("orient", 0.1);
      if (this.cancelled) return this.finishCancelled(summary, state);
      const scan = await this.store.scan();
      emit("gather", 0.3);
      if (this.cancelled) return this.finishCancelled(summary, state);
      const proposals = this.agent ? await this.agent.consolidate(scan.records.filter((record) => record.status === "active")) : [];
      emit("consolidate", 0.55);
      for (const proposal of proposals) {
        if (this.cancelled) return this.finishCancelled(summary, state);
        try {
          if (!proposal.replacement || !proposal.sources?.length) {
            summary.skipped.push("proposal");
            continue;
          }
          const sourceRecords = scan.records.filter((record) => proposal.sources!.includes(record.id) && record.status === "active");
          if (sourceRecords.length === 0) {
            summary.skipped.push("proposal");
            continue;
          }
          const replacement = await this.store.remember({
            type: proposal.replacement.type ?? sourceRecords[0].type,
            scope: sourceRecords[0].scope,
            description: proposal.replacement.description,
            content: proposal.replacement.content,
            confidence: Math.max(...sourceRecords.map((record) => record.confidence)),
            supersedes: sourceRecords.map((record) => record.id),
            source: { trigger: "autodream" },
          });
          summary.changed.push(replacement.id);
          for (const source of sourceRecords) {
            await this.store.archive(source.id, `superseded by ${replacement.id}`);
            summary.archived.push(source.id);
          }
        } catch (error) {
          summary.failed.push({ error: error instanceof Error ? error.message : String(error) });
        }
      }
      emit("prune", 0.85);
      await this.store.writeOperationalState({
        ...state,
        status: "completed",
        phase: "completed",
        lastRunAt: this.now(),
        lastScanAt: this.now(),
        newSessions: 0,
        changedCount: summary.changed.length,
        skippedCount: summary.skipped.length,
        failedCount: summary.failed.length,
      });
      emit("completed", 1);
      return summary;
    } catch (error) {
      summary.status = "failed";
      summary.failed.push({ error: error instanceof Error ? error.message : String(error) });
      await this.store.writeOperationalState({ ...state, status: "failed", phase: "failed", lastError: summary.failed[summary.failed.length - 1].error });
      emit("failed", 1);
      return summary;
    } finally {
      await this.store.releaseLock();
    }
  }

  private async finishCancelled(summary: AutoDreamRunSummary, state: AutoDreamState): Promise<AutoDreamRunSummary> {
    summary.status = "cancelled";
    await this.store.writeOperationalState({ ...state, status: "cancelled", phase: "cancelled" });
    return summary;
  }
}
