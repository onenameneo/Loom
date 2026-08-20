import { Check, Circle, CircleAlert, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible } from "radix-ui";
import type { TodoPlanSnapshot } from "../env";
import { useI18n } from "../i18n/I18nProvider";

const itemClasses = {
  completed: "text-loom-faint line-through",
  in_progress: "text-loom-text font-semibold",
  blocked: "text-loom-muted",
  pending: "text-loom-muted",
} as const;

const statusClasses = {
  completed: "text-loom-ok",
  in_progress: "text-loom-accent",
  blocked: "text-loom-err",
  pending: "text-loom-faint",
} as const;

export function TodoProgressPanel({ plan }: { plan?: TodoPlanSnapshot }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { setExpanded(true); }, [plan?.planId]);
  if (!plan || plan.status === "cleared") {
    return <div className="todo-progress-panel todo-progress-panel--empty pointer-events-none h-0 w-full border-0 opacity-0" aria-hidden="true" />;
  }
  const completed = plan.todos.filter((todo) => todo.status === "completed").length;
  const icon = (status: keyof typeof statusClasses) => {
    const className = `inline-flex shrink-0 ${statusClasses[status]}`;
    if (status === "completed") return <Check className={className} size={13} />;
    if (status === "in_progress") return <LoaderCircle className={`${className} animate-spin motion-reduce:animate-none`} size={13} />;
    if (status === "blocked") return <CircleAlert className={className} size={13} />;
    return <Circle className={className} size={13} />;
  };
  return (
    <Collapsible.Root
      className="todo-progress-panel group box-border w-full overflow-hidden rounded-loom-md border border-loom-border bg-loom-surface transition-[border-color] duration-150 ease-loom"
      role="region"
      aria-label={t("plan.label")}
      open={expanded}
      onOpenChange={setExpanded}
    >
      <Collapsible.Trigger asChild>
        <button
          className="todo-progress-header flex min-h-[38px] w-full cursor-pointer items-center gap-loom-2 border-0 bg-transparent px-[10px] py-[7px] text-left font-[inherit] text-loom-muted hover:bg-loom-surface-2 active:bg-loom-surface-2 focus-visible:outline-2 focus-visible:outline-loom-accent focus-visible:outline-offset-[-2px]"
          type="button"
          aria-label={t("plan.toggle")}
        >
          <span className="todo-progress-title font-loom-mono text-[10px] font-semibold leading-none tracking-[0.08em] text-loom-text">PLAN</span>
          <span className="todo-progress-count font-loom-mono text-[10px] leading-none text-loom-faint">{completed} / {plan.todos.length}</span>
          <ChevronDown className="todo-progress-chevron ml-auto transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] group-data-[state=closed]:-rotate-90" size={14} aria-hidden="true" />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="todo-progress-content overflow-hidden" forceMount>
        <div className="todo-progress-clip max-h-[360px] overflow-hidden opacity-100 transition-[max-height,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none group-data-[state=closed]:max-h-0 group-data-[state=closed]:opacity-0">
          <div className="todo-progress-list max-h-[180px] min-h-0 overflow-y-auto px-[10px] pb-[9px]" role="list" aria-live="polite">
            {plan.todos.map((todo) => (
              <div className={`todo-progress-item flex items-start gap-loom-2 py-[3px] text-[11px] leading-[1.35] ${itemClasses[todo.status]}`} role="listitem" key={todo.id}>
                <span className="todo-progress-status inline-flex shrink-0 text-loom-faint" aria-hidden="true">{icon(todo.status)}</span>
                <span className="todo-progress-item-text min-w-0 break-words [overflow-wrap:anywhere]">{todo.content}</span>
              </div>
            ))}
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
