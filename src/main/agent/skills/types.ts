export type SkillSourceScope = "global" | "project";
export type SkillDiagnosticLevel = "info" | "warn" | "error";

export interface SkillDiagnostic {
  level: SkillDiagnosticLevel;
  code: string;
  message: string;
  path?: string;
}

export interface SkillSource {
  id: string;
  scope: SkillSourceScope;
  rootPath: string;
  projectName?: string;
  trusted: boolean;
  registered: boolean;
  projectId?: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  disableModelInvocation: boolean;
  scope: SkillSourceScope;
  sourceId: string;
  rootPath: string;
  skillFilePath: string;
  hash: string;
  trusted: boolean;
  active: boolean;
  diagnostics: SkillDiagnostic[];
}

export interface SkillCatalog {
  sources: SkillSource[];
  skills: SkillCatalogItem[];
  activeSkills: SkillCatalogItem[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillSnapshot {
  id: string;
  name: string;
  description: string;
  sourceScope: SkillSourceScope;
  sourceId: string;
  sourcePath: string;
  hash: string;
}

export type SkillEventAction = "skill-enabled" | "skill-disabled";

export interface LoomSkillEvent {
  role: "loomSkillEvent";
  customType: "loom.skill-event";
  eventId: string;
  action: SkillEventAction;
  skill: SkillSnapshot;
  timestamp: number;
}

export interface EffectiveSkill extends SkillSnapshot {
  enabledEventId: string;
  disabledEventId?: string;
  diagnostics: SkillDiagnostic[];
  current?: SkillCatalogItem;
}

export interface EffectiveSkillState {
  skills: EffectiveSkill[];
  eventIds: string[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillSourceSettings {
  globalSources: string[];
}
