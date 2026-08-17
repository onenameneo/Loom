import { MemoryStore } from "./storage";
import type { MemoryCandidateInput, MemoryRecord, MemoryScope } from "./types";
import { isMemoryType, normalizeConfidence, type MemoryType } from "./types";

export type MemoryCommand =
  | { kind: "remember"; type: MemoryType; content: string }
  | { kind: "forget"; id: string };

export interface TurnMemoryInput {
  sessionId: string;
  nodeId: string;
  projectId?: string;
  userText: string;
  assistantText?: string;
  sourceKey?: string;
  signal?: AbortSignal;
  /** Set by the primary-agent write path so the fallback extractor does not duplicate it. */
  primaryMemoryWritten?: boolean;
}

export interface ExtractedMemoryProposal {
  type: MemoryType;
  scope: MemoryScope;
  description: string;
  content: string;
  confidence: number;
  dedupeKey?: string;
}

export interface RestrictedExtractor {
  run(input: TurnMemoryInput): Promise<ExtractedMemoryProposal[]>;
}

export function parseMemoryCommand(input: string): MemoryCommand | undefined {
  const text = input.trim();
  const remember = text.match(/^\/(?:remember|记住)(?:\s+(user|feedback|project|reference))?\s+([\s\S]+)$/i);
  if (remember) {
    const type = (remember[1]?.toLowerCase() ?? "user") as MemoryType;
    if (!isMemoryType(type)) return undefined;
    return { kind: "remember", type, content: remember[2].trim() };
  }
  const forget = text.match(/^\/(?:forget|遗忘)\s+([A-Za-z0-9._-]+)$/i);
  return forget ? { kind: "forget", id: forget[1] } : undefined;
}

export class MemoryExtractionService {
  constructor(
    private readonly store: MemoryStore,
    private readonly extractor?: RestrictedExtractor,
    private readonly options: { maxDurationMs?: number; maxProposals?: number } = {},
  ) {}

  async afterTurn(input: TurnMemoryInput): Promise<{ candidates: MemoryRecord[]; skipped: boolean; error?: string }> {
    const state = await this.store.readOperationalState({ version: 1, cursors: {} });
    const sourceKey = input.sourceKey ?? `${input.sessionId}:${input.nodeId}:${input.userText}`;
    const cursors = state.cursors && typeof state.cursors === "object" ? state.cursors as Record<string, string> : {};
    if (cursors[input.sessionId] === sourceKey) return { candidates: [], skipped: true };
    try {
      if (input.primaryMemoryWritten || !this.extractor) {
        await this.store.writeOperationalState({ ...state, cursors: { ...cursors, [input.sessionId]: sourceKey }, lastExtractionAt: Date.now() });
        return { candidates: [], skipped: true };
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("memory extractor timed out"));
        }, this.options.maxDurationMs ?? 3_000);
      });
      let proposals: ExtractedMemoryProposal[];
      try {
        proposals = await Promise.race([this.extractor.run({ ...input, signal: controller.signal }), timeout]);
      } catch (error) {
        if (controller.signal.aborted) throw new Error("memory extractor timed out");
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const candidates: MemoryRecord[] = [];
      for (const proposal of (Array.isArray(proposals) ? proposals : []).slice(0, this.options.maxProposals ?? 5)) {
        if (!isMemoryType(proposal.type) || !proposal.content.trim() || !proposal.description.trim()) continue;
        if (proposal.scope.kind === "project" && proposal.scope.projectId !== input.projectId) continue;
        const candidate: MemoryCandidateInput = {
          type: proposal.type,
          scope: proposal.scope,
          description: proposal.description,
          content: proposal.content,
          confidence: normalizeConfidence(proposal.confidence),
          dedupeKey: proposal.dedupeKey,
          source: { trigger: "extracted", sessionId: input.sessionId, nodeId: input.nodeId, excerpt: input.userText.slice(0, 240) },
        };
        const record = await this.store.createCandidate(candidate);
        if (record?.status === "candidate") candidates.push(record);
      }
      await this.store.writeOperationalState({ ...state, cursors: { ...cursors, [input.sessionId]: sourceKey }, lastExtractionAt: Date.now() });
      return { candidates, skipped: proposals.length === 0 };
    } catch (error) {
      return { candidates: [], skipped: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
