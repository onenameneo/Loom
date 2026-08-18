import type { AgentMetricRecord, AgentMetricTotals } from "../../../common/telemetry";
import { mergeLlmUsage } from "./usage";

/** Pure aggregation for the durable metrics read model and all UI consumers. */
export function summarizeMetricRecords(records: AgentMetricRecord[]): AgentMetricTotals {
  let turns = 0;
  let llmRequests = 0;
  let toolCalls = 0;
  let compactions = 0;
  let durationMs = 0;
  let ttftMs = 0;
  let ttftSamples = 0;
  let llmDurationMs = 0;
  let outputTokens = 0;
  const llmUsage: AgentMetricRecord["usage"][] = [];

  for (const record of records) {
    if (record.kind === "turn") {
      turns += 1;
      durationMs += record.durationMs ?? 0;
    } else if (record.kind === "llm") {
      llmRequests += 1;
      llmDurationMs += record.durationMs ?? 0;
      outputTokens += record.usage?.output ?? 0;
      llmUsage.push(record.usage);
      if (record.ttftMs !== undefined) {
        ttftMs += record.ttftMs;
        ttftSamples += 1;
      }
    } else if (record.kind === "tool") {
      toolCalls += 1;
    } else if (record.kind === "compaction") {
      compactions += 1;
    }
  }

  return {
    turns,
    llmRequests,
    toolCalls,
    compactions,
    durationMs,
    ttftMs,
    ttftSamples,
    outputTokensPerSecond: llmDurationMs > 0 ? outputTokens / (llmDurationMs / 1_000) : 0,
    usage: mergeLlmUsage(llmUsage),
  };
}
