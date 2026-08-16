import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentTelemetryPort, IdPort, ClockPort, EventSinkPort, StorePort } from "../ports";
import {
  DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
  DEFAULT_POST_COMPACTION_ATTACHMENT_ITEM_TOKENS,
  planContextAttachments,
  syntheticAttachmentTokenDiagnostic,
  type LoomContextAttachmentCandidate,
  type AttachmentPlan,
} from "../core/attachments";
import { estimateMessageTokensUnbounded, estTokens, type ContextBudgetAllocation, type ContextModelMetadata } from "../core/budget";
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
import { normalizeLlmUsage } from "../core/usage";

export interface CompactionSummaryResult {
  summary: string;
  usage?: LoomUsageDiagnostic;
}

export interface CompactionServiceDeps {
  summarize(
    input: CheckpointSummaryInput,
    options: { signal?: AbortSignal; maxOutputTokens: number; model?: ContextModelMetadata },
  ): Promise<CompactionSummaryResult>;
  store: Pick<StorePort, "appendMessages">;
  clock: ClockPort;
  ids: IdPort;
  syncEngine(nodeId: string): void;
  telemetry: AgentTelemetryPort;
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
  model?: ContextModelMetadata;
  budget?: ContextBudgetAllocation;
  attachmentCandidates?: LoomContextAttachmentCandidate[];
  attachmentBudgetTokens?: number;
}

export interface CompactNodeInput extends PlanNodeCompactionInput {
  signal?: AbortSignal;
  maxSummaryOutputTokens?: number;
}

export type CompactNodeResult =
  | { ok: true; checkpoint: LoomContextCheckpointMessage }
  | { ok: false; reason: "not_needed" | "aborted" | "empty_summary" | "failed" | "unavailable" | "fixed_context_overflow"; error?: string };

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
  attachments?: LoomContextCheckpointMessage["diagnostics"]["attachments"];
  summaryUsage?: LoomUsageDiagnostic;
  reason?: string;
  error?: string;
}

export function createCompactionService(deps: CompactionServiceDeps): CompactionService {
  const compactionStartedAt = new Map<string, number>();

  function emitPlan(input: PlanNodeCompactionInput, plan: TurnSafeCutPlan, beginSpan: boolean): string | undefined {
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
    if (!beginSpan) return undefined;
    const compactionId = deps.ids.message();
    compactionStartedAt.set(compactionId, payload.at);
    deps.telemetry.emit({
      type: "compaction_start",
      nodeId: input.nodeId,
      turnId: input.turnId,
      compactionId,
      at: payload.at,
      attributes: payload as unknown as Record<string, unknown>,
    });
    return compactionId;
  }

  return {
    planNodeCompaction(input) {
      const plan = planTurnSafeCut(input.messages, {
        tailBudgetTokens: input.tailBudgetTokens,
        tokenCounter: input.tokenCounter,
      });
      emitPlan(input, plan, false);
      return plan;
    },
    async compactNode(input) {
      const plan = planTurnSafeCut(input.messages, {
        tailBudgetTokens: input.tailBudgetTokens,
        tokenCounter: input.tokenCounter,
      });
      if (plan.kind === "none") return { ok: false, reason: "not_needed" };
      if (input.budget?.status === "model-unavailable") {
        return { ok: false, reason: "unavailable", error: input.model?.diagnostic || "Model context metadata is unavailable." };
      }
      if (input.budget?.status === "fixed-context-overflow") {
        return { ok: false, reason: "fixed_context_overflow", error: "Fixed context exceeds the selected model input budget." };
      }
      const spanId = emitPlan(input, plan, true);
      try {
        const summaryInput = buildCheckpointSummaryInput({
          previousCheckpoint: input.previousCheckpoint,
          messages: input.messages,
          range: { fromSeq: 0, toSeq: plan.compactThroughSeq },
        });
        const result = await deps.summarize(summaryInput, {
          signal: input.signal,
          maxOutputTokens: input.maxSummaryOutputTokens ?? 2_048,
          model: input.model,
        });
        if (input.signal?.aborted) {
          emitTerminal(input, spanId, "aborted", { reason: "signal-aborted" });
          return { ok: false, reason: "aborted" };
        }
        const summary = result.summary.trim();
        if (!summary) {
          emitTerminal(input, spanId, "failed", { reason: "empty-summary" });
          return { ok: false, reason: "empty_summary" };
        }
        const attachmentPlan = planAttachments(input);
        const attachmentDiagnostics = {
          selectedCount: attachmentPlan.diagnostics.selectedCount,
          omittedCount: attachmentPlan.diagnostics.omittedCount,
          tokens: attachmentPlan.diagnostics.tokens,
          source: attachmentPlan.diagnostics.source,
        } as const;
        const beforeTokens = input.messages.reduce((sum, msg) => sum + estimateMessageTokensUnbounded(msg), 0);
        const afterTokens = plan.retainedTokenCount + estTokens(summary.length) + attachmentPlan.diagnostics.tokens;
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
            ...(input.budget ? {
              ...(input.budget.model ? { model: { providerId: input.budget.model.providerId, modelId: input.budget.model.modelId } } : {}),
              contextWindowTokens: input.budget.model?.contextWindowTokens,
              reserveOutputTokens: input.budget.reserveOutputTokens,
              projectedInputTokens: input.budget.projectedInputTokens,
              fixedContextTokens: input.budget.fixedContextTokens,
              nodeLocalTailBudgetTokens: input.budget.nodeLocalTailBudget,
              attachmentBudgetTokens: input.budget.attachmentBudgetTokens,
              overflowTokens: input.budget.overflowTokens,
              accountingSource: input.budget.source,
            } : {}),
            attachments: attachmentDiagnostics,
          },
          summaryUsage: result.usage,
          attachments: attachmentPlan.attachments,
        });
        deps.store.appendMessages(input.nodeId, [{ id: checkpoint.id, seq: 0, role: checkpoint.role, content: checkpoint as unknown as AgentMessage }]);
        deps.syncEngine(input.nodeId);
        emitTerminal(input, spanId, "succeeded", {
          checkpointId: checkpoint.id,
          coverage: checkpoint.coverage,
          retainedTail: checkpoint.retainedTail,
          diagnostics: checkpoint.diagnostics,
          attachments: attachmentDiagnostics,
          summaryUsage: checkpoint.summaryUsage,
        });
        return { ok: true, checkpoint };
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
        emitTerminal(input, spanId, input.signal?.aborted ? "aborted" : "failed", {
          error: message,
        });
        return input.signal?.aborted ? { ok: false, reason: "aborted" } : { ok: false, reason: "failed", error: message };
      }
    },
  };

  function emitTerminal(
    input: PlanNodeCompactionInput,
    spanId: string | undefined,
    state: "succeeded" | "failed" | "aborted",
    extra: Omit<CompactionLifecycleEventPayload, "state" | "trigger" | "at">,
  ) {
    const payload: CompactionLifecycleEventPayload = { state, trigger: input.trigger, at: deps.clock.now(), ...extra };
    deps.events.emit(input.nodeId, "compaction", payload);
    const compactionId = spanId ?? deps.ids.message();
    const startedAt = compactionStartedAt.get(compactionId);
    compactionStartedAt.delete(compactionId);
    deps.telemetry.emit({
      type: "compaction_end",
      nodeId: input.nodeId,
      turnId: input.turnId,
      compactionId,
      status: state === "succeeded" ? "ok" : state === "failed" ? "error" : "aborted",
      at: payload.at,
      ...(startedAt !== undefined ? { durationMs: Math.max(0, payload.at - startedAt) } : {}),
      ...(payload.summaryUsage ? { usage: normalizeLlmUsage(payload.summaryUsage, { source: payload.summaryUsage.exact ? "provider" : "estimated", exact: payload.summaryUsage.exact }) } : {}),
      attributes: payload as unknown as Record<string, unknown>,
    });
  }

  function planAttachments(input: CompactNodeInput): AttachmentPlan {
    try {
      return planContextAttachments(input.attachmentCandidates ?? [], {
        maxTokens: Math.min(
          Math.max(0, input.attachmentBudgetTokens ?? input.budget?.attachmentBudgetTokens ?? DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS),
          DEFAULT_POST_COMPACTION_ATTACHMENT_BUDGET_TOKENS,
        ),
        maxItemTokens: DEFAULT_POST_COMPACTION_ATTACHMENT_ITEM_TOKENS,
        tokenCounter: syntheticAttachmentTokenDiagnostic,
      });
    } catch {
      return {
        attachments: [],
        diagnostics: { selectedCount: 0, omittedCount: input.attachmentCandidates?.length ?? 0, tokens: 0, source: "estimated", omissions: [] },
      };
    }
  }
}
