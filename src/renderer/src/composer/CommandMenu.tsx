import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconPlus } from "../icons";
import type { CmdCtx } from "./commands";
import { visibleCommands } from "./commands";
import { useI18n } from "../i18n/I18nProvider";

export function CommandMenu({ ctx }: { ctx: CmdCtx }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const items = useMemo(() => visibleCommands("insert", ctx.getState()), [ctx]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menuRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function run(index: number) {
    const cmd = items[index];
    if (!cmd) return;
    cmd.run(ctx);
    setOpen(false);
  }

  return (
    <div className="cmd-menu-root nodrag" ref={rootRef}>
      <button
        type="button"
        className="cmd-plus"
        title={t("composer.insert")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconPlus size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="composer-popover cmd-menu"
          role="menu"
          id={listId}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => (i + 1) % items.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => (i - 1 + items.length) % items.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(active);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          {items.map((cmd, index) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.id}
                id={`${listId}-${index}`}
                type="button"
                role="menuitem"
                className={`cmd-row ${index === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(index)}
              >
                <Icon size={15} />
                <span>{cmd.label}</span>
                {cmd.hint && <small>{cmd.hint}</small>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
