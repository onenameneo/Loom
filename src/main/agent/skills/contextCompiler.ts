import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { EffectiveSkillState } from "./types";

export type SkillProviderCapabilities = {
  midConversationSystemMessages: boolean;
};

export function detectSkillProviderCapabilities(input: { providerId?: string; compatibility?: unknown }): SkillProviderCapabilities {
  const compatibility = input.compatibility && typeof input.compatibility === "object" ? input.compatibility as Record<string, unknown> : {};
  if (typeof compatibility.midConversationSystemMessages === "boolean") {
    return { midConversationSystemMessages: compatibility.midConversationSystemMessages };
  }
  return { midConversationSystemMessages: false };
}

export interface SkillContextDiagnostics {
  eventIds: string[];
  cacheKey: string;
  firstDivergence: "skill-context-tail" | "none";
  mode: "system" | "structured-user";
}

export interface SkillContextCompileResult {
  messages: Message[];
  diagnostics: SkillContextDiagnostics;
}

function systemMsg(text: string, timestamp: number): Message {
  return { role: "system", content: text, timestamp } as unknown as Message;
}

function userMsg(text: string, timestamp: number): UserMessage {
  return { role: "user", content: text, timestamp };
}

export function compileSkillContext(input: {
  state: EffectiveSkillState;
  capabilities: SkillProviderCapabilities;
  now?: number;
}): SkillContextCompileResult {
  const now = input.now ?? 0;
  const skills = [...input.state.skills].sort((a, b) => a.id.localeCompare(b.id));
  const eventIds = [...input.state.eventIds];
  const cacheKey = eventIds.join("|");
  if (skills.length === 0) {
    return {
      messages: [],
      diagnostics: { eventIds, cacheKey, firstDivergence: "none", mode: input.capabilities.midConversationSystemMessages ? "system" : "structured-user" },
    };
  }
  const body = [
    "Loom active skills for this branch:",
    ...skills.map((skill) => [
      `- ${skill.name} (${skill.id})`,
      `  description: ${skill.description}`,
      `  source: ${skill.sourceScope} ${skill.sourcePath}`,
      `  hash: ${skill.hash}`,
      "  Use skill_read to inspect SKILL.md, references, or assets before following detailed skill instructions.",
    ].join("\n")),
  ].join("\n");
  const mode = input.capabilities.midConversationSystemMessages ? "system" : "structured-user";
  return {
    messages: [mode === "system" ? systemMsg(body, now) : userMsg(`[Loom skill context]\n${body}`, now)],
    diagnostics: { eventIds, cacheKey, firstDivergence: "skill-context-tail", mode },
  };
}
