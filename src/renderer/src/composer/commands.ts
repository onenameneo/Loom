import type { LucideIcon } from "lucide-react";
import { Archive, BookOpen, Cpu, Eraser, Image, RefreshCw } from "lucide-react";

export type CmdState = {
  model?: string;
  canRegenerate: boolean;
};

export type CmdCtx = {
  nodeId: string;
  attachImage: () => void;
  openPersona: () => void;
  clearNode: () => void;
  regenerate: () => void;
  setModel: (id: string) => void;
  compact: () => void;
  enableSkill?: (id: string) => void;
  getState: () => CmdState;
};

export type Command = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: "insert" | "action";
  hint?: string;
  arg?: "text";
  when?: (s: CmdState) => boolean;
  run: (ctx: CmdCtx, arg?: string) => void;
};

export const commands: Command[] = [
  {
    id: "insert-image",
    label: "附加图片",
    icon: Image,
    group: "insert",
    hint: "选择图片随消息发送",
    run: (ctx) => ctx.attachImage(),
  },
  {
    id: "model",
    label: "/model",
    icon: Cpu,
    group: "action",
    hint: "/model <模型名>",
    arg: "text",
    run: (ctx, arg) => {
      const model = arg?.trim();
      if (model) ctx.setModel(model);
    },
  },
  {
    id: "skill",
    label: "/skill",
    icon: BookOpen,
    group: "action",
    hint: "/skill <技能名>",
    arg: "text",
    run: (ctx, arg) => {
      const skill = arg?.trim();
      if (skill) ctx.enableSkill?.(skill);
    },
  },
  {
    id: "clear",
    label: "/clear",
    icon: Eraser,
    group: "action",
    hint: "清空本节点",
    run: (ctx) => ctx.clearNode(),
  },
  {
    id: "compact",
    label: "/compact",
    icon: Archive,
    group: "action",
    hint: "压缩本节点上下文",
    run: (ctx) => ctx.compact(),
  },
  {
    id: "retry",
    label: "/retry",
    icon: RefreshCw,
    group: "action",
    hint: "重答上一轮",
    when: (s) => s.canRegenerate,
    run: (ctx) => ctx.regenerate(),
  },
];

export function visibleCommands(group: Command["group"], state: CmdState): Command[] {
  return commands.filter((cmd) => cmd.group === group && (!cmd.when || cmd.when(state)));
}
