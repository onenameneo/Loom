import {
  Bot,
  Brain,
  Cpu,
  MonitorCog,
  Palette,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "../i18n/I18nProvider";

export type SettingsSectionId =
  | "appearance"
  | "workstation"
  | "models"
  | "permissions"
  | "memory"
  | "skills"
  | "mcp";

export type SettingsSectionGroupId = "general" | "agent" | "extensions";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  group: SettingsSectionGroupId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
}

export interface SettingsSectionGroup {
  id: SettingsSectionGroupId;
  labelKey: TranslationKey;
  sections: SettingsSectionDefinition[];
}

const section = (
  id: SettingsSectionId,
  group: SettingsSectionGroupId,
  labelKey: TranslationKey,
  descriptionKey: TranslationKey,
  icon: LucideIcon,
): SettingsSectionDefinition => ({ id, group, labelKey, descriptionKey, icon });

export const SETTINGS_NAV_GROUPS: SettingsSectionGroup[] = [
  {
    id: "general",
    labelKey: "settings.sectionGeneral",
    sections: [
      section("appearance", "general", "settings.appearance", "settings.appearanceHelp", Palette),
      section("workstation", "general", "settings.workstation", "settings.workstationHelp", MonitorCog),
    ],
  },
  {
    id: "agent",
    labelKey: "settings.sectionAgent",
    sections: [
      section("models", "agent", "settings.modelConfig", "settings.manageModels", Cpu),
      section("permissions", "agent", "settings.agentPermissions", "settings.permissionsHelp", ShieldCheck),
      section("memory", "agent", "settings.memory", "settings.memoryHelp", Brain),
    ],
  },
  {
    id: "extensions",
    labelKey: "settings.sectionExtensions",
    sections: [
      section("skills", "extensions", "settings.skills", "settings.manageSkills", Sparkles),
      section("mcp", "extensions", "settings.mcp", "settings.manageMcp", Bot),
    ],
  },
];

export const SETTINGS_SECTIONS = SETTINGS_NAV_GROUPS.flatMap((group) => group.sections);
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "models";
export const SETTINGS_SECTION_STORAGE_KEY = "loom:settings:section";

export function isSettingsSection(value: string | null | undefined): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function readStoredSettingsSection(): SettingsSectionId {
  try {
    const stored = localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY);
    return isSettingsSection(stored) ? stored : DEFAULT_SETTINGS_SECTION;
  } catch {
    return DEFAULT_SETTINGS_SECTION;
  }
}
