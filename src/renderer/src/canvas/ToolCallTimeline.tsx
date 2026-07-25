import { ChevronDown, CircleCheck, CircleDashed, CircleX, Wrench } from "lucide-react";
import { useState } from "react";
import type { ToolCallView } from "./toolTimeline";

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

function StateIcon({ call }: { call: ToolCallView }) {
  if (call.state !== "end") return <CircleDashed size={13} />;
  if (call.isError) return <CircleX size={13} />;
  return <CircleCheck size={13} />;
}

export function ToolCallTimeline({ calls, density = "comfortable" }: { calls: ToolCallView[]; density?: "compact" | "comfortable" }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (calls.length === 0) return null;

  return (
    <div className={`tool-timeline tool-timeline--${density}`}>
      {calls.map((call) => {
        const details = formatDetails(call.details ?? call.args);
        const expanded = open.has(call.id);
        return (
          <div className={`tool-row tool-row--${stateLabel(call)}`} key={call.id}>
            <button
              className="tool-row__main nodrag"
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(call.id)) next.delete(call.id);
                  else next.add(call.id);
                  return next;
                });
              }}
            >
              <span className="tool-row__state">
                <StateIcon call={call} />
              </span>
              <span className="tool-row__name"><Wrench size={12} /> {call.name}</span>
              <span className="tool-row__summary">{call.summary || stateLabel(call)}</span>
              <span className="tool-row__id">{call.id.slice(0, 8)}</span>
              <ChevronDown className="tool-row__chev" size={13} />
            </button>
            {expanded && details && <pre className="tool-row__details">{details}</pre>}
          </div>
        );
      })}
    </div>
  );
}
