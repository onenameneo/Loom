import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CanvasNodeModel } from "../core/graph";
import type { SkillCatalog, SkillCatalogItem, SkillDiagnostic, LoomSkillEvent, SkillEventAction, SkillSnapshot, EffectiveSkillState } from "./types";
import { skillSnapshot } from "./catalog";

export const SKILL_EVENT_CUSTOM_TYPE = "loom.skill-event";

export function isSkillEventMessage(msg: AgentMessage): msg is LoomSkillEvent & AgentMessage {
  const anyMsg = msg as any;
  return anyMsg?.role === "loomSkillEvent" && anyMsg?.customType === SKILL_EVENT_CUSTOM_TYPE && typeof anyMsg.eventId === "string";
}

export function createSkillEvent(input: {
  eventId: string;
  action: SkillEventAction;
  skill: SkillCatalogItem | SkillSnapshot;
  timestamp: number;
}): LoomSkillEvent {
  const skill = "sourcePath" in input.skill ? input.skill : skillSnapshot(input.skill);
  return {
    role: "loomSkillEvent",
    customType: SKILL_EVENT_CUSTOM_TYPE,
    eventId: input.eventId,
    action: input.action,
    skill,
    timestamp: input.timestamp,
  };
}

export function replaySkillEvents(
  nodes: Array<Pick<CanvasNodeModel, "id" | "messages">>,
  catalog?: Pick<SkillCatalog, "activeSkills" | "skills">,
): EffectiveSkillState {
  const effective = new Map<string, {
    snapshot: SkillSnapshot;
    enabledEventId: string;
    disabledEventId?: string;
    diagnostics: SkillDiagnostic[];
  }>();
  const seenEvents = new Set<string>();
  const eventIds: string[] = [];

  for (const node of nodes) {
    for (const msg of node.messages) {
      if (!isSkillEventMessage(msg)) continue;
      if (seenEvents.has(msg.eventId)) continue;
      seenEvents.add(msg.eventId);
      eventIds.push(msg.eventId);
      if (msg.action === "skill-enabled") {
        effective.set(msg.skill.id, {
          snapshot: msg.skill,
          enabledEventId: msg.eventId,
          diagnostics: [],
        });
      } else {
        const current = effective.get(msg.skill.id);
        if (current) {
          effective.set(msg.skill.id, { ...current, disabledEventId: msg.eventId });
        } else {
          effective.set(msg.skill.id, {
            snapshot: msg.skill,
            enabledEventId: msg.eventId,
            disabledEventId: msg.eventId,
            diagnostics: [],
          });
        }
      }
    }
  }

  const activeCatalog = new Map((catalog?.activeSkills ?? []).map((skill) => [skill.id, skill]));
  const allCatalog = new Map((catalog?.skills ?? []).map((skill) => [`${skill.id}:${skill.rootPath}`, skill]));
  const skills = [...effective.values()]
    .filter((item) => !item.disabledEventId)
    .map((item) => {
      const current = activeCatalog.get(item.snapshot.id);
      const exact = allCatalog.get(`${item.snapshot.id}:${item.snapshot.sourcePath}`);
      const diagnostics: SkillDiagnostic[] = [...item.diagnostics];
      if (!exact) {
        diagnostics.push({ level: "warn", code: "source-missing", message: "Enabled skill source is no longer discovered.", path: item.snapshot.sourcePath });
      } else if (exact.hash !== item.snapshot.hash) {
        diagnostics.push({ level: "warn", code: "hash-drift", message: "Enabled skill file hash differs from the activation snapshot.", path: exact.skillFilePath });
      }
      return {
        ...item.snapshot,
        enabledEventId: item.enabledEventId,
        diagnostics,
        current,
      };
    });
  const diagnostics = skills.flatMap((skill) => skill.diagnostics);
  return { skills, eventIds, diagnostics };
}

