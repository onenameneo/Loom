import type { Message } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../modelConfig/registry";
import { createRuntimeModelsFromRegistry } from "../modelConfig/runtimeModels";
import { loadScopedModelSettings, resolveSelectedModel } from "../modelConfig/scopes";
import { isMemoryScope, isMemoryType, normalizeConfidence, type MemoryScope, type MemoryType } from "./types";
import type { ExtractedMemoryProposal, RestrictedExtractor, TurnMemoryInput } from "./extraction";

interface RawProposal {
  type?: unknown;
  scope?: unknown;
  description?: unknown;
  content?: unknown;
  confidence?: unknown;
  dedupeKey?: unknown;
}

/**
 * A deliberately narrow extractor: it has no tools and receives only the new
 * turn plus the current project id. It can propose candidates, never active
 * memories, and MemoryExtractionService owns all persistence and validation.
 */
export function createRuntimeMemoryExtractor(deps: { loadRegistry: () => Promise<ModelRegistry> }): RestrictedExtractor {
  return {
    async run(input) {
      const registry = await deps.loadRegistry();
      const scoped = loadScopedModelSettings({});
      const selected = resolveSelectedModel({ registry, scoped });
      if (!selected.model || !selected.available) throw new Error(selected.diagnostic?.message || "Memory extractor model is unavailable.");
      const models = await createRuntimeModelsFromRegistry(registry);
      const model = models.getModel(selected.ref.providerId, selected.ref.modelId);
      if (!model) throw new Error(`Memory extractor model template not found: ${selected.ref.providerId}/${selected.ref.modelId}`);
      const stream = models.streamSimple(model, { messages: extractorMessages(input) }, { signal: input.signal, maxTokens: 700 });
      const streamedText = collectStreamText(stream);
      const result = await stream.result();
      return parseProposals(textFromResult(result) || await streamedText, input);
    },
  };
}

function extractorMessages(input: TurnMemoryInput): Message[] {
  const userText = input.userText.trim().slice(0, 8_000);
  const assistantText = (input.assistantText ?? "").trim().slice(0, 8_000);
  const project = input.projectId ?? "";
  return [{
    role: "user",
    content: [
      "You are Loom's background long-term-memory reviewer.",
      "Review only this new conversation turn. Return JSON only: an array of durable memory candidates, or [].",
      "Never save temporary task state, code facts, secrets, credentials, or anything already derivable from files.",
      "Candidates must use type user, feedback, project, or reference; scope must be user or the current project.",
      "Do not treat a normal statement as an explicit command. Propose only facts likely to remain useful across sessions.",
      'Schema: [{"type":"user|feedback|project|reference","scope":{"kind":"user"}|{"kind":"project","projectId":"..."},"description":"short","content":"durable fact","confidence":0.0,"dedupeKey":"stable optional key"}]',
      `Current project id: ${project || "none"}`,
      `New user message:\n${userText}`,
      assistantText ? `New assistant response:\n${assistantText}` : undefined,
    ].filter(Boolean).join("\n\n"),
    timestamp: 0,
  }];
}

function parseProposals(raw: string, input: TurnMemoryInput): ExtractedMemoryProposal[] {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = json.indexOf("[");
  const end = json.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => normalizeProposal(item as RawProposal, input));
}

function normalizeProposal(item: RawProposal, input: TurnMemoryInput): ExtractedMemoryProposal[] {
  if (!isMemoryType(item.type) || typeof item.description !== "string" || typeof item.content !== "string") return [];
  const scope = normalizeScope(item.scope, input.projectId);
  if (!scope) return [];
  const description = item.description.trim().slice(0, 240);
  const content = item.content.trim().slice(0, 1_000);
  if (!description || !content) return [];
  return [{
    type: item.type as MemoryType,
    scope,
    description,
    content,
    confidence: normalizeConfidence(item.confidence),
    dedupeKey: typeof item.dedupeKey === "string" ? item.dedupeKey.trim().slice(0, 240) : undefined,
  }];
}

function normalizeScope(value: unknown, projectId?: string): MemoryScope | undefined {
  if (!isMemoryScope(value)) return undefined;
  if (value.kind === "project" && value.projectId !== projectId) return undefined;
  return value;
}

async function collectStreamText(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: string[] = [];
  for await (const event of stream) {
    const value = event as any;
    if (typeof value?.delta === "string" && (value.type === "text_delta" || value.type === "delta")) chunks.push(value.delta);
    else if (typeof value?.content === "string" && value.type === "text_end") chunks.push(value.content);
  }
  return chunks.join("");
}

function textFromResult(value: any): string {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.outputText === "string") return value.outputText;
  const content = value?.message?.content ?? value?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text ?? "").join("");
  return "";
}
