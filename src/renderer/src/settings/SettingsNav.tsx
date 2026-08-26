import { useMemo, useRef, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { cn } from "../ui/styles";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_NAV_GROUPS,
  type SettingsSectionId,
} from "./settingsNavigation";

export function SettingsNav({
  value = DEFAULT_SETTINGS_SECTION,
  onValueChange,
}: {
  value?: SettingsSectionId;
  onValueChange: (value: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const sections = useMemo(() => SETTINGS_NAV_GROUPS.flatMap((group) => group.sections), []);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
        : event.key === "Home" ? -Infinity
          : event.key === "End" ? Infinity
            : 0;
    if (!direction) return;
    event.preventDefault();
    const nextIndex = direction === Infinity
      ? sections.length - 1
      : direction === -Infinity
        ? 0
        : (index + direction + sections.length) % sections.length;
    const next = sections[nextIndex];
    buttons.current[nextIndex]?.focus();
    onValueChange(next.id);
  }

  return (
    <nav className="settings-nav min-h-0 min-w-0 flex-1 overflow-y-auto px-loom-2 pb-loom-3" aria-label={t("settings.navigation")}>
      {SETTINGS_NAV_GROUPS.map((group) => (
        <div className="settings-nav__group" key={group.id}>
          <div className="settings-nav__group-label px-loom-2 pb-loom-1 pt-loom-4 font-loom-mono text-[10px] uppercase tracking-[0.06em] text-loom-faint">
            {t(group.labelKey)}
          </div>
          <div className="grid gap-px">
            {group.sections.map((section) => {
              const index = sections.findIndex((item) => item.id === section.id);
              const Icon = section.icon;
              const active = section.id === value;
              return (
                <button
                  key={section.id}
                  ref={(node) => { buttons.current[index] = node; }}
                  type="button"
                  className={cn(
                    "settings-nav__item group flex min-h-[34px] w-full cursor-pointer items-center gap-loom-2 rounded-loom-sm border border-transparent px-loom-2 text-left text-[12px] text-loom-muted",
                    "transition-[color,border-color] duration-150 ease-loom hover:text-loom-text",
                    "focus-visible:outline-2 focus-visible:outline-loom-accent focus-visible:outline-offset-1",
                    active && "active font-medium text-loom-text",
                  )}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onValueChange(section.id)}
                  onKeyDown={(event) => moveFocus(event, index)}
                >
                  <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span className="min-w-0 truncate">{t(section.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
