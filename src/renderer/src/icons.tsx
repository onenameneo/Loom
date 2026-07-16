// 图标统一走 lucide-react（best practice）。这里做一层薄封装：
// 固定 strokeWidth 以贴合 DESIGN.md 的克制线条，名字保持稳定，替换零成本。
import {
  ArrowUp,
  Code2,
  Command,
  Cpu,
  Eraser,
  Eye,
  Image,
  Moon,
  Plus,
  Radar,
  RefreshCw,
  Settings,
  Sun,
  Workflow,
  type LucideProps,
} from "lucide-react";

const mk = (Icon: React.ComponentType<LucideProps>) => (p: LucideProps) => (
  <Icon strokeWidth={1.75} {...p} />
);

export const IconWorkspace = mk(Workflow); // 会话（画布/分支）
export const IconEye = mk(Radar); // 观察哨（监控）
export const IconSettings = mk(Settings);
export const IconSun = mk(Sun);
export const IconMoon = mk(Moon);
export const IconSend = mk(ArrowUp);
export const IconPlus = mk(Plus);
export const IconImage = mk(Image);
export const IconCode = mk(Code2);
export const IconCommand = mk(Command);
export const IconCpu = mk(Cpu);
export const IconRefresh = mk(RefreshCw);
export const IconEraser = mk(Eraser);

// 备用：保留原 Eye 供他处使用
export const IconWatch = mk(Eye);
