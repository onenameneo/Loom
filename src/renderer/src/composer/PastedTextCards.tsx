import { useId, useState } from "react";
import { ChevronDown, FileText, Pencil, X } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";
import type { TextFragment } from "./pastedDraft";

export function PastedTextCards({ fragments, disabled, onEdit, onRemove }: {
  fragments: TextFragment[];
  disabled: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="pasted-text-cards nowheel" hidden={!fragments.length}>
      {fragments.map((fragment, index) => {
        const open = expanded === fragment.id;
        const label = t("composer.textFragment", { number: index + 1 });
        const previewId = `${id}-${fragment.id}`;
        return (
          <div className="pasted-text-card" key={fragment.id}>
            <div className="pasted-text-card__header">
              <button type="button" className="pasted-text-card__toggle" aria-expanded={open} aria-controls={previewId} onClick={() => setExpanded(open ? null : fragment.id)}>
                <FileText size={14} aria-hidden="true" />
                <span>{label}</span><small>{t("composer.characterCount", { count: fragment.text.length.toLocaleString() })}</small>
                <ChevronDown size={14} aria-hidden="true" data-expanded={open} />
              </button>
              <button type="button" disabled={disabled} aria-label={t("composer.editFragment", { number: index + 1 })} onClick={() => onEdit(fragment.id)}><Pencil size={13} aria-hidden="true" /></button>
              <button type="button" disabled={disabled} aria-label={t("composer.removeFragment", { number: index + 1 })} onClick={() => onRemove(fragment.id)}><X size={13} aria-hidden="true" /></button>
            </div>
            <div className="pasted-text-card__summary" hidden={open}>{fragment.text.trim().slice(0, 120)}</div>
            <div id={previewId} className="pasted-text-card__content" data-expanded={open} aria-hidden={!open}>
              <pre tabIndex={open ? 0 : -1}>{fragment.text}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
