import { ChevronDown, SquareTerminal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ApprovalRequestPayload, ApprovalScope } from "../env";
import { useI18n } from "../i18n/I18nProvider";

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

function permissionReasonLabel(reason: string | undefined, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  switch (reason) {
    case "outside_workspace": return t("approval.reasonOutsideWorkspace");
    case "network_access": return t("approval.reasonNetwork");
    case "destructive_command": return t("approval.reasonDestructive");
    case "external_mutation": return t("approval.reasonExternal");
    case "permission_escalation": return t("approval.reasonEscalation");
    case "untrusted_command": return t("approval.reasonUntrusted");
    default: return reason;
  }
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
  const { t } = useI18n();
  const allowLabel = approval.scope === "once" ? t("approval.once") : approval.scope === "node-session" ? t("approval.nodeSession") : t("approval.persistent");
  const detail = previewArgsText(approval.preview.args);
  const allowOptions: Array<{ scope: ApprovalScope; label: string }> = [
    { scope: "once", label: t("approval.once") },
    { scope: "node-session", label: t("approval.nodeSession") },
    { scope: "persistent", label: t("approval.persistent") },
  ];

  return (
    <div className={`approval-prompt ${compact ? "approval-prompt--compact" : ""}`} role="group" aria-label={t("approval.tools")}>
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
        {(approval.reason || approval.sandboxMode) && (
          <div className="approval-prompt__detail">
            {[permissionReasonLabel(approval.reason, t), approval.sandboxMode && `sandbox: ${approval.sandboxMode}`].filter(Boolean).join(" · ")}
          </div>
        )}
        <div className="approval-prompt__target">{approval.target}</div>
      </div>
      <div className="approval-prompt__actions">
        <button type="button" className="approval-prompt__deny" onClick={() => onDecision("deny")} aria-label={t("approval.deny")}>
          {t("common.deny")}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="approval-prompt__allow" aria-label={t("approval.allow")}>
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
