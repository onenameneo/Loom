import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useState } from "react";
import type { SkillCatalogItemDto } from "../env";
import type { CmdCtx, Command } from "./commands";
import { visibleCommands } from "./commands";

function parseSlash(value: string): { name: string; arg: string; hasSpace: boolean } {
  const raw = value.slice(1);
  const space = raw.search(/\s/);
  if (space < 0) return { name: raw, arg: "", hasSpace: false };
  return { name: raw.slice(0, space), arg: raw.slice(space + 1), hasSpace: true };
}

export type SlashPaletteHandle = {
  handleKeyDown: (event: { key: string; preventDefault: () => void }) => void;
};

export const SlashPalette = forwardRef<SlashPaletteHandle, {
  value: string;
  setValue: (value: string) => void;
  ctx: CmdCtx;
  modelOptions: { id: string; name: string }[];
  onClose?: () => void;
  onNoMatch?: () => void;
  onUnknownCommand?: (message: string) => void;
}>(function SlashPalette({
  value,
  setValue,
  ctx,
  modelOptions,
  onClose,
  onNoMatch,
  onUnknownCommand,
}, ref) {
  const [active, setActive] = useState(0);
  const listId = useId();
  const state = ctx.getState();
  const parsed = value.startsWith("/") ? parseSlash(value) : { name: "", arg: "", hasSpace: false };
  const actionCommands = useMemo(() => visibleCommands("action", state), [state]);
  const filtered = actionCommands.filter((cmd) => {
    const needle = parsed.name.toLowerCase();
    return !needle || cmd.id.startsWith(needle) || cmd.label.toLowerCase().includes(needle);
  });
  const modelCommand = actionCommands.find((cmd) => cmd.id === "model");
  const skillCommand = actionCommands.find((cmd) => cmd.id === "skill");
  const modelMode = Boolean(modelCommand && parsed.name === "model" && parsed.hasSpace);
  const skillMode = Boolean(skillCommand && parsed.name === "skill" && parsed.hasSpace);
  const [skills, setSkills] = useState<SkillCatalogItemDto[]>([]);
  const models = modelMode ? modelOptions : [];
  const modelNeedle = parsed.arg.trim().toLowerCase();
  const modelItems = models.filter((m) => !modelNeedle || m.id.toLowerCase().includes(modelNeedle) || m.name.toLowerCase().includes(modelNeedle));
  const skillNeedle = parsed.arg.trim().toLowerCase();
  const skillItems = skillMode ? skills.filter((s) => !skillNeedle || s.id.includes(skillNeedle) || s.name.toLowerCase().includes(skillNeedle) || s.description.toLowerCase().includes(skillNeedle)) : [];
  const count = modelMode ? modelItems.length : skillMode ? skillItems.length : filtered.length;
  const ModelIcon = modelCommand?.icon;
  const SkillIcon = skillCommand?.icon;

  useEffect(() => {
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!skillMode || !window.api) return;
    let cancelled = false;
    window.api.canvas.skills(ctx.nodeId).then((result) => {
      if (!cancelled) setSkills(result.catalog.activeSkills);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.nodeId, skillMode]);

  function executeCommand(cmd: Command) {
    if (cmd.arg === "text" && !parsed.hasSpace) {
      setValue(`/${cmd.id} `);
      return;
    }
    cmd.run(ctx, parsed.arg);
    setValue("");
    onClose?.();
  }

  function executeModel(index: number) {
    const model = modelItems[index]?.id;
    if (!model || !modelCommand) {
      onUnknownCommand?.("没有匹配的已添加模型");
      return;
    }
    modelCommand.run(ctx, model);
    setValue("");
    onClose?.();
  }

  function executeSkill(index: number) {
    const skill = skillItems[index]?.id;
    if (!skill || !skillCommand) {
      onUnknownCommand?.("没有匹配的 Skill");
      return;
    }
    skillCommand.run(ctx, skill);
    setValue("");
    onClose?.();
  }

  function onKeyDown(event: { key: string; preventDefault: () => void }) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (count ? (i + 1) % count : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (count ? (i - 1 + count) % count : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (modelMode) executeModel(active);
      else if (skillMode) executeSkill(active);
      else if (filtered[active]) executeCommand(filtered[active]);
      else onNoMatch?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
    }
  }

  useImperativeHandle(ref, () => ({ handleKeyDown: onKeyDown }));

  if (!value.startsWith("/")) return null;

  return (
    <div
      className="composer-popover slash-palette nodrag"
      role="listbox"
      aria-activedescendant={`${listId}-${active}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {modelMode ? (
        <>
          {modelItems.map((model, index) => (
            <button
              key={model.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`cmd-row ${index === active ? "is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => executeModel(index)}
            >
              {ModelIcon && <ModelIcon size={15} />}
              <span>{model.id}</span>
              <small>{model.name}</small>
            </button>
          ))}
          {modelItems.length === 0 && <div className="cmd-empty">没有匹配的已添加模型</div>}
        </>
      ) : skillMode ? (
        <>
          {skillItems.map((skill, index) => (
            <button
              key={`${skill.sourceId}:${skill.id}`}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`cmd-row ${index === active ? "is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => executeSkill(index)}
            >
              {SkillIcon && <SkillIcon size={15} />}
              <span>{skill.name}</span>
              <small>{skill.scope} · {skill.hash}</small>
            </button>
          ))}
          {skillItems.length === 0 && <div className="cmd-empty">没有匹配的 Skill</div>}
        </>
      ) : filtered.length ? (
        filtered.map((cmd, index) => {
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`cmd-row ${index === active ? "is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => executeCommand(cmd)}
            >
              <Icon size={15} />
              <span>{cmd.label}</span>
              {cmd.hint && <small>{cmd.hint}</small>}
            </button>
          );
        })
      ) : (
        <div className="cmd-empty">没有匹配命令</div>
      )}
    </div>
  );
});
