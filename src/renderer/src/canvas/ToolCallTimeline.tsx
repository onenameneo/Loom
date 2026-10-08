import { ChevronRight, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState } from "react";
import { useI18n, type TranslationKey } from "../i18n/I18nProvider";
import { toolCallSubject, type ToolCallView } from "./toolTimeline";

const toolLabels: Record<string, TranslationKey> = {
  read: "process.read", read_file: "process.read",
  project_list_files: "process.list", project_find_files: "process.search", project_grep: "process.search",
  write: "process.write", edit: "process.edit", run_command: "process.command",
  web_fetch: "process.fetch", write_todos: "process.plan", task: "process.task",
};

function formatDetails(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  const json = (value as any)?.json;
  if (typeof json === "string") return json;
  const text = (value as any)?.text;
  if (typeof text === "string") return text;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stateLabel(call: ToolCallView) {
  if (call.state !== "end") return "running";
  return call.isError ? "error" : "done";
}

function delegatedChildId(details: unknown): string | undefined {
  const raw = details && typeof details === "object" && typeof (details as { json?: unknown }).json === "string"
    ? (() => { try { return JSON.parse((details as { json: string }).json); } catch { return undefined; } })()
    : details;
  return raw && typeof raw === "object" && typeof (raw as { childNodeId?: unknown }).childNodeId === "string"
    ? (raw as { childNodeId: string }).childNodeId
    : undefined;
}

function StateIcon({ call }: { call: ToolCallView }) {
  if (call.state !== "end") return <CircleDashed size={13} />;
  if (call.isError) return <CircleX size={13} />;
  return <CircleCheck size={13} />;
}

export function ToolCallTimeline({ calls, density = "comfortable", onOpenChild }: { calls: ToolCallView[]; density?: "compact" | "comfortable"; onOpenChild?: (nodeId: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (calls.length === 0) return null;

  return (
    <div className={`tool-timeline tool-timeline--${density}`}>
      {calls.map((call) => {
        const details = formatDetails(call.details);
        const args = formatDetails(call.args);
        const subject = toolCallSubject(call);
        const path = (call.args as { path?: unknown } | undefined)?.path;
        const displaySubject = typeof path === "string" && path === subject ? path.split(/[/\\]/).filter(Boolean).pop() || path : subject;
        const label = toolLabels[call.name] ? t(toolLabels[call.name]) : call.name;
        const childNodeId = call.name === "task" ? delegatedChildId(call.details) : undefined;
        const expanded = open.has(call.id);
        return (
          <Collapsible.Root className={`tool-row tool-row--${stateLabel(call)}`} key={call.id} open={expanded} onOpenChange={(nextOpen) => {
            setOpen((prev) => {
              const next = new Set(prev);
              if (nextOpen) next.add(call.id);
              else next.delete(call.id);
              return next;
            });
          }}>
            <Collapsible.Trigger
              className="tool-row__main nodrag"
              type="button"
              title={subject || call.summary || label}
              aria-label={`${label} ${call.isError ? call.summary || subject || "" : subject || call.summary || ""}`}
            >
              <span className="tool-row__state">
                <StateIcon call={call} />
              </span>
              <span className="tool-row__name">{label}</span>
              <span className="tool-row__summary">{call.isError ? call.summary || subject : displaySubject || call.summary || t(call.state === "end" ? "process.done" : "process.running")}</span>
              <ChevronRight className="tool-row__chev" size={13} aria-hidden="true" />
            </Collapsible.Trigger>
            <Collapsible.Content forceMount className="process-content" aria-hidden={!expanded} {...(!expanded ? { inert: "" } : {})}>
              <div className="process-collapse" data-state={expanded ? "open" : "closed"}>
                <div className="process-collapse__inner">
                  <div className="tool-row__details">
                    <div className="tool-row__meta">{call.name} · {call.id}</div>
                    {args && <><strong>{t("process.arguments")}</strong><pre>{args}</pre></>}
                    {details && <><strong>{t("process.output")}</strong><pre>{details}</pre></>}
                  </div>
                </div>
              </div>
            </Collapsible.Content>
            {childNodeId && (
              <button className="tool-row__open-child nodrag" type="button" onClick={() => onOpenChild?.(childNodeId)}>
                {t("process.openBranch")}
              </button>
            )}
          </Collapsible.Root>
        );
      })}
    </div>
  );
}
