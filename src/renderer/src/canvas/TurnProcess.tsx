import { useLayoutEffect, useState, type ReactNode } from "react";
import { ChevronRight, CircleDashed, CircleX } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useI18n } from "../i18n/I18nProvider";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { toolCallSubject, type ToolTimelineMessage } from "./toolTimeline";

export function TurnProcess<T extends ToolTimelineMessage & { id: string | number }>({
  messages, running = false, awaitingApproval = false, outcome, density = "comfortable", focusMessageSeq, renderMessage, onOpenChild,
}: {
  messages: T[];
  running?: boolean;
  awaitingApproval?: boolean;
  outcome?: "running" | "awaiting_approval" | "completed" | "aborted" | "failed";
  density?: "compact" | "comfortable";
  focusMessageSeq?: number;
  renderMessage: (message: T) => ReactNode;
  onOpenChild?: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const calls = messages.flatMap((message) => message.toolCall ? [message.toolCall] : []);
  const errors = calls.filter((call) => call.isError);
  const reads = calls.filter((call) => call.name === "read" || call.name === "read_file").length;
  const searches = calls.filter((call) => call.name === "project_grep" || call.name === "project_find_files").length;
  const other = calls.length - reads - searches;
  const counts = [
    reads ? t("process.readCount", { count: reads }) : "",
    searches ? t("process.searchCount", { count: searches }) : "",
    other ? t("process.toolCount", { count: other }) : "",
  ].filter(Boolean).join(" · ");
  const latest = [...calls].reverse().find((call) => call.state !== "end");
  const activity = latest ? toolCallSubject(latest) || latest.name : t("process.responding");
  const status = awaitingApproval ? t("process.awaitingApproval")
    : running ? t("process.running")
    : outcome === "aborted" ? t("process.stopped")
    : outcome === "failed" ? t("process.failed")
    : t("process.done");
  const containsFocus = typeof focusMessageSeq === "number" && messages.some((message) => message.seq === focusMessageSeq);
  const statusLabel = calls.length || outcome === "aborted" || outcome === "failed" ? status : running ? t("process.thinking") : t("process.label");

  useLayoutEffect(() => {
    if (containsFocus) setOpen(true);
  }, [focusMessageSeq, containsFocus]);

  return (
    <Collapsible.Root className={`turn-process turn-process--${density}`} open={open} onOpenChange={setOpen} data-running={running}>
      <Collapsible.Trigger className="turn-process__trigger nodrag" type="button" aria-label={[
        statusLabel, counts, running && !awaitingApproval ? activity : "", errors.length ? t("process.errorCount", { count: errors.length }) : "",
      ].filter(Boolean).join(" ")}>
        <ChevronRight className="turn-process__chevron" size={14} aria-hidden="true" />
        {running && <CircleDashed size={13} aria-hidden="true" />}
        <span role={running ? "status" : undefined}>{statusLabel}</span>
        {counts && <span className="turn-process__counts">{counts}</span>}
        {running && !awaitingApproval && <span className="turn-process__activity" title={activity}>{activity}</span>}
        {errors.length > 0 && <span className="turn-process__error-count">{t("process.errorCount", { count: errors.length })}</span>}
      </Collapsible.Trigger>
      {errors.length > 0 && (
        <div className="turn-process__errors" role="status">
          {errors.map((call) => <div key={call.id}><CircleX size={13} aria-hidden="true" /><span>{call.summary || call.name}</span></div>)}
        </div>
      )}
      <Collapsible.Content forceMount className="process-content" aria-hidden={!open} {...(!open ? { inert: "" } : {})}>
        <div className="process-collapse" data-state={open ? "open" : "closed"}>
          <div className="process-collapse__inner">
            <div className="turn-process__timeline">
              {messages.map((message) => message.toolCall ? (
                <ToolCallTimeline key={message.id} calls={[message.toolCall]} density={density} onOpenChild={onOpenChild} />
              ) : (
                <div className="turn-process__note" key={message.id}>{renderMessage(message)}</div>
              ))}
            </div>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
