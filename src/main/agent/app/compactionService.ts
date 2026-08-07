import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { IdPort, ClockPort, EventSinkPort, StorePort } from "../ports";
import { estimateMessageTokensUnbounded, estTokens } from "../core/budget";
import {
  buildCheckpointSummaryInput,
  planTurnSafeCut,
  type CheckpointSummaryInput,
  type TurnSafeCutPlan,
} from "../core/compaction";
import {
  createLoomContextCheckpoint,
  type LoomCompactionReason,
  type LoomContextCheckpointMessage,
  type LoomUsageDiagnostic,
} from "../core/messages";

export interface CompactionSummaryResult {
  summary: string;
  usage?: LoomUsageDiagnostic;
}

export interface CompactionServiceDeps {
  summarize(
    input: CheckpointSummaryInput,
    options: { signal?: AbortSignal; maxOutputTokens: number },
  ): Promise<CompactionSummaryResult>;
  store: Pick<StorePort, "appendMessages">;
  clock: ClockPort;
  ids: IdPort;
  syncEngine(nodeId: string): void;
  trace: {
    append(nodeId: string, turnId: string, kind: "event" | "error", payload: unknown): void;
  };
  events: EventSinkPort;
}

export interface PlanNodeCompactionInput {
  nodeId: string;
  turnId?: string;
  trigger: LoomCompactionReason;
  messages: AgentMessage[];
  tailBudgetTokens: number;
  tokenCounter?: (msg: AgentMessage, index: number) => number;
  /** Original node transcript offset for a checkpoint-uncovered tail. */
  sourceOffset?: number;
  previousCheckpoint?: LoomContextCheckpointMessage;
}

export interface CompactNodeInput extends PlanNodeCompactionInput {
  signal?: AbortSignal;
  maxSummaryOutputTokens?: number;
}

export type CompactNodeResult =
  | { ok: true; checkpoint: LoomContextCheckpointMessage }
  | { ok: false; reason: "not_needed" | "aborted" | "empty_summary" | "failed"; error?: string };

export interface CompactionService {
  planNodeCompaction(input: PlanNodeCompactionInput): TurnSafeCutPlan;
  compactNode(input: CompactNodeInput): Promise<CompactNodeResult>;
}

export interface CompactionLifecycleEventPayload {
  state: "planned" | "succeeded" | "failed" | "aborted";
  trigger: LoomCompactionReason;
  at: number;
  kind?: TurnSafeCutPlan["kind"];
  compactThroughSeq?: number;
  retainedFromSeq?: number;
  retainedTokenCount?: number;
  checkpointId?: string;
  coverage?: { fromSeq: number; toSeq: number };
  retainedTail?: { fromSeq: number; toSeq: number };
  diagnostics?: LoomContextCheckpointMessage["diagnostics"];
  summaryUsage?: LoomUsageDiagnostic;
  reason?: string;
  error?: string;
}

export function createCompactionService(deps: CompactionServiceDeps): CompactionService {
  function emitPlan(input: PlanNodeCompactionInput, plan: TurnSafeCutPlan) {
    const payload: CompactionLifecycleEventPayload = {
      state: "planned",
      trigger: input.trigger,
      at: deps.clock.now(),
      kind: plan.kind,
      compactThroughSeq: plan.compactThroughSeq,
      retainedFromSeq: plan.retainedFromSeq,
      retainedTokenCount: plan.retainedTokenCount,
    };
    deps.events.emit(input.nodeId, "compaction", payload);
    if (input.turnId) deps.trace.append(input.nodeId, input.turnId, "event", payload);
  }

  return {
    planNodeCompaction(input) {
      const plan = planTurnSafeCut(input.messages, {
        tailBudgetTokens: input.tailBudgetTokens,
        tokenCounter: input.tokenCounter,
      });
      emitPlan(input, plan);
      return plan;
    },
    async compactNode(input) {
      const plan = planTurnSafeCut(input.messages, {
        tailBudgetTokens: input.tailBudgetTokens,
        tokenCounter: input.tokenCounter,
      });
      emitPlan(input, plan);
      if (plan.kind === "none") return { ok: false, reason: "not_needed" };
      try {
        const summaryInput = buildCheckpointSummaryInput({
          previousCheckpoint: input.previousCheckpoint,
          messages: input.messages,
          range: { fromSeq: 0, toSeq: plan.compactThroughSeq },
        });
        const result = await deps.summarize(summaryInput, {
          signal: input.signal,
          maxOutputTokens: input.maxSummaryOutputTokens ?? 2_048,
        });
        if (input.signal?.aborted) {
          emitTerminal(input, "aborted", { reason: "signal-aborted" });
          return { ok: false, reason: "aborted" };
        }
        const summary = result.summary.trim();
        if (!summary) {
          emitTerminal(input, "failed", { reason: "empty-summary" });
          return { ok: false, reason: "empty_summary" };
        }
        const beforeTokens = input.messages.reduce((sum, msg) => sum + estimateMessageTokensUnbounded(msg), 0);
        const afterTokens = plan.retainedTokenCount + estTokens(summary.length);
        const checkpoint = createLoomContextCheckpoint({
          id: deps.ids.message(),
          nodeId: input.nodeId,
          createdAt: deps.clock.now(),
          reason: input.trigger,
          summary,
          coverage: { fromSeq: input.sourceOffset ?? 0, toSeq: (input.sourceOffset ?? 0) + plan.compactThroughSeq },
          retainedTail: {
            fromSeq: (input.sourceOffset ?? 0) + plan.retainedFromSeq,
            toSeq: Math.max((input.sourceOffset ?? 0) + plan.retainedFromSeq, (input.sourceOffset ?? 0) + input.messages.length - 1),
          },
          diagnostics: {
            before: { tokens: beforeTokens, exact: false },
            after: { tokens: afterTokens, exact: false },
          },
          summaryUsage: result.usage,
        });
        deps.store.appendMessages(input.nodeId, [{ id: checkpoint.id, seq: 0, role: checkpoint.role, content: checkpoint as unknown as AgentMessage }]);
        deps.syncEngine(input.nodeId);
        emitTerminal(input, "succeeded", {
          checkpointId: checkpoint.id,
          coverage: checkpoint.coverage,
          retainedTail: checkpoint.retainedTail,
          diagnostics: checkpoint.diagnostics,
          summaryUsage: checkpoint.summaryUsage,
        });
        return { ok: true, checkpoint };
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
        emitTerminal(input, input.signal?.aborted ? "aborted" : "failed", {
          error: message,
        });
        return input.signal?.aborted ? { ok: false, reason: "aborted" } : { ok: false, reason: "failed", error: message };
      }
    },
  };

  function emitTerminal(
    input: PlanNodeCompactionInput,
    state: "succeeded" | "failed" | "aborted",
    extra: Omit<CompactionLifecycleEventPayload, "state" | "trigger" | "at">,
  ) {
    const payload: CompactionLifecycleEventPayload = { state, trigger: input.trigger, at: deps.clock.now(), ...extra };
    deps.events.emit(input.nodeId, "compaction", payload);
    if (input.turnId) deps.trace.append(input.nodeId, input.turnId, state === "failed" ? "error" : "event", payload);
  }
}
