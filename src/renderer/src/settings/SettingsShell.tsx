import { useEffect, useRef } from "react";
import type { SurfaceCtx } from "../surfaces";
import { useI18n } from "../i18n/I18nProvider";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./settingsNavigation";
import { AppearanceSettings } from "./sections/AppearanceSettings";
import { MemorySettings } from "./sections/MemorySettings";
import { ModelsSettings } from "./sections/ModelsSettings";
import { PermissionsSettings } from "./sections/PermissionsSettings";
import { WorkstationSettings } from "./sections/WorkstationSettings";
import { SkillsSettings } from "./sections/SkillsSettings";
import { McpSettings } from "./sections/McpSettings";
import { SettingsSectionFrame, SettingsSectionHeader } from "./components/SettingsSection";

const SECTION_COMPONENTS: Record<SettingsSectionId, (props: { ctx: SurfaceCtx }) => JSX.Element | null> = {
  appearance: AppearanceSettings,
  workstation: WorkstationSettings,
  models: ModelsSettings,
  permissions: PermissionsSettings,
  memory: MemorySettings,
  skills: SkillsSettings,
  mcp: McpSettings,
};

export function SettingsShell({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionId = ctx.settingsSection ?? DEFAULT_SETTINGS_SECTION;
  const section = SETTINGS_SECTIONS.find((item) => item.id === sectionId) ?? SETTINGS_SECTIONS.find((item) => item.id === DEFAULT_SETTINGS_SECTION)!;
  const Section = SECTION_COMPONENTS[section.id];

  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [section.id]);

  useEffect(() => {
    ctx.setSettingsSectionState?.(null);
  }, [ctx.setSettingsSectionState, section.id]);

  return (
    <div className="settings-shell h-full min-h-0 overflow-y-auto">
      <main className="settings-page mx-auto w-full max-w-[840px] px-8 pb-16 pt-8" aria-labelledby="settings-page-title">
        <SettingsSectionHeader
          eyebrow={t("nav.settings")}
          title={t(section.labelKey)}
          description={t(section.descriptionKey)}
          headingRef={headingRef}
        />
        <div className="settings-page__body">
          <SettingsSectionFrame>
            <Section ctx={ctx} />
          </SettingsSectionFrame>
        </div>
      </main>
    </div>
  );
}
