import { useRef, type ReactNode, type KeyboardEvent } from "react";
import { Dialog } from "radix-ui";
import { useI18n } from "../i18n/I18nProvider";
import { Modal } from "./dialogs";
import { buttonClassName } from "./styles";

export function TextEditorDialog({ open, onOpenChange, title, value, onChange, onKeyDown, accessory, selection, onSelectionChange, onReturnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  accessory?: ReactNode;
  selection?: { start: number; end: number };
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onReturnFocus?: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <Modal open={open} onOpenChange={onOpenChange} ariaLabel={title} className="text-editor-content" overlayClassName="text-editor-overlay"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        inputRef.current?.focus();
        if (selection) inputRef.current?.setSelectionRange(selection.start, selection.end);
      }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (onReturnFocus) onReturnFocus(); else returnFocusRef.current?.focus({ preventScroll: true }); }}
    >
      <div className="settings-modal__panel text-editor-dialog">
        <Dialog.Title className="dlg-title">{title}</Dialog.Title>
        <Dialog.Description className="text-editor-dialog__description">{t("composer.editorHint")}</Dialog.Description>
        {accessory}
        <textarea ref={inputRef} className="text-editor-dialog__input nowheel" aria-label={title} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} onSelect={(event) => onSelectionChange?.({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} />
        <div className="text-editor-dialog__footer">
          <span>{t("composer.characterCount", { count: value.length.toLocaleString() })}</span>
          <Dialog.Close asChild><button type="button" className={buttonClassName("default")}>{t("composer.finishEditing")}</button></Dialog.Close>
        </div>
      </div>
    </Modal>
  );
}
