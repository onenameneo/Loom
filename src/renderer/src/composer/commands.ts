import type { LucideIcon } from "lucide-react";
import { BookOpen, Code2, Cpu, Eraser, Image, Paperclip, RefreshCw, Settings, Workflow } from "lucide-react";

export type CmdState = {
  mount: boolean;
  model?: string;
  canRegenerate: boolean;
};

export type CmdCtx = {
  nodeId: string;
  insertText: (t: string) => void;
  attachImage: () => void;
  toggleMount: (on: boolean) => void;
  openPersona: () => void;
  clearNode: () => void;
  regenerate: () => void;
  setModel: (id: string) => void;
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

const codeFence = "\n```\n\n```\n";

export const commands: Command[] = [
  {
    id: "insert-code",
    label: "插入代码块",
    icon: Code2,
    group: "insert",
    hint: "插入围栏代码块",
    run: (ctx) => ctx.insertText(codeFence),
  },
  {
    id: "insert-mount",
    label: "挂载祖先",
    icon: Workflow,
    group: "insert",
    hint: "把根到父节点的上下文一并发送",
    run: (ctx) => ctx.toggleMount(!ctx.getState().mount),
  },
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
    id: "persona",
    label: "/persona",
    icon: Settings,
    group: "action",
    hint: "打开节点 persona",
    run: (ctx) => ctx.openPersona(),
  },
  {
    id: "mount",
    label: "/mount",
    icon: Workflow,
    group: "action",
    hint: "切换挂载祖先",
    run: (ctx) => ctx.toggleMount(!ctx.getState().mount),
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
    id: "retry",
    label: "/retry",
    icon: RefreshCw,
    group: "action",
    hint: "重答上一轮",
    when: (s) => s.canRegenerate,
    run: (ctx) => ctx.regenerate(),
  },
  {
    id: "attach",
    label: "/attach",
    icon: Paperclip,
    group: "action",
    hint: "选择图片",
    run: (ctx) => ctx.attachImage(),
  },
];

export function visibleCommands(group: Command["group"], state: CmdState): Command[] {
  return commands.filter((cmd) => cmd.group === group && (!cmd.when || cmd.when(state)));
}
