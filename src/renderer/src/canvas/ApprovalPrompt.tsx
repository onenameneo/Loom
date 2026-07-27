import { ChevronDown, SquareTerminal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ApprovalRequestPayload, ApprovalScope } from "../env";

export type ApprovalState = ApprovalRequestPayload & { scope: ApprovalScope };

function previewArgsText(args: unknown): string | undefined {
  if (args == null) return undefined;
  if (typeof args === "string") return args;
  if (typeof args !== "object") return String(args);
  const entries = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)}`);
  return entries.length ? entries.join(" · ") : undefined;
}

export function ApprovalPrompt({
  approval,
  compact = false,
  onScopeChange,
  onDecision,
}: {
  approval: ApprovalState;
  compact?: boolean;
  onScopeChange: (scope: ApprovalScope) => void;
  onDecision: (action: "allow" | "deny", scope?: ApprovalScope) => void;
}) {
  const allowLabel = approval.scope === "once" ? "允许一次" : approval.scope === "node-session" ? "允许本节点" : "记住并允许";
  const detail = previewArgsText(approval.preview.args);
  const allowOptions: Array<{ scope: ApprovalScope; label: string }> = [
    { scope: "once", label: "允许一次" },
    { scope: "node-session", label: "允许本节点" },
    { scope: "persistent", label: "记住并允许" },
  ];

  return (
    <div className={`approval-prompt ${compact ? "approval-prompt--compact" : ""}`} role="group" aria-label="工具审批">
      <div className="approval-prompt__head">
        <span className="approval-prompt__icon" aria-hidden="true">
          <SquareTerminal size={16} />
        </span>
        <span className="approval-prompt__eyebrow">{approval.toolName}</span>
      </div>
      <div className="approval-prompt__copy">
        <div className="approval-prompt__title">{approval.preview.title}</div>
        {approval.preview.description && <div className="approval-prompt__desc">{approval.preview.description}</div>}
        {detail && <div className="approval-prompt__detail">{detail}</div>}
        <div className="approval-prompt__target">{approval.target}</div>
      </div>
      <div className="approval-prompt__actions">
        <button type="button" className="approval-prompt__deny" onClick={() => onDecision("deny")} aria-label="拒绝工具调用">
          拒绝
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="approval-prompt__allow" aria-label="允许工具调用">
            <span>{allowLabel}</span>
            <ChevronDown size={14} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="approval-select-content" sideOffset={6} align="end">
              {allowOptions.map((option) => (
                <DropdownMenu.Item
                  className="approval-select-item"
                  key={option.scope}
                  onSelect={() => {
                    onScopeChange(option.scope);
                    onDecision("allow", option.scope);
                  }}
                >
                  {option.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
