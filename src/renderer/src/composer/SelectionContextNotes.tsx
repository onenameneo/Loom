import { Check, MessageSquareText, Pencil, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useState } from "react";
import type { SelectionContextNote } from "../../../common/selectionContext";
import { createSelectionContextNote } from "../../../common/selectionContext";
import { useI18n } from "../i18n/I18nProvider";

function SelectionNoteEditor({
  selectedText,
  annotation,
  textareaId,
  onAnnotationChange,
  onCancel,
  onConfirm,
}: {
  selectedText: string;
  annotation: string;
  textareaId: string;
  onAnnotationChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <div className="selection-note-capture__quote" title={selectedText}>{selectedText}</div>
      <label htmlFor={textareaId}>{t("selection.annotationOptional")}</label>
      <textarea
        autoFocus
        id={textareaId}
        value={annotation}
        placeholder={t("selection.annotationPlaceholder")}
        onChange={(event) => onAnnotationChange(event.target.value)}
      />
      <div className="selection-note-capture__actions">
        <button type="button" className="selection-note-secondary" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" className="selection-note-confirm" onClick={onConfirm}>
          <Check size={13} aria-hidden="true" />
          {t("common.confirm")}
        </button>
      </div>
    </>
  );
}

export function SelectionNoteCapture({
  selectedText,
  onConfirm,
  onOpenChange,
}: {
  selectedText: string;
  onConfirm: (annotation: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const textareaId = useId();

  function confirm() {
    onConfirm(annotation);
    setAnnotation("");
    handleOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <Popover.Trigger asChild>
        <button type="button" className="selection-note-capture-trigger" aria-label={t("selection.addToConversation")} title={t("selection.addToConversation")} onClick={() => setOpen(true)}>
          <MessageSquareText size={13} aria-hidden="true" />
          <span>{t("selection.addToConversation")}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="selection-note-capture nodrag"
          data-selection-note-popup="true"
          side="bottom"
          align="start"
          sideOffset={8}
          onPointerDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SelectionNoteEditor
            selectedText={selectedText}
            annotation={annotation}
            textareaId={textareaId}
            onAnnotationChange={setAnnotation}
            onCancel={() => handleOpenChange(false)}
            onConfirm={confirm}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SelectionNotesPopover({
  notes,
  onChange,
}: {
  notes: SelectionContextNote[];
  onChange: (notes: SelectionContextNote[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SelectionContextNote | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState("");
  const listId = useId();

  useEffect(() => {
    if (editingNote) setOpen(true);
  }, [editingNote]);

  if (notes.length === 0) return null;

  function closePopover() {
    setOpen(false);
    setEditingNote(null);
    setEditingAnnotation("");
  }

  function editNote(note: SelectionContextNote) {
    setOpen(false);
    setEditingNote(note);
    setEditingAnnotation(note.annotation);
  }

  function saveEdit() {
    if (!editingNote) return;
    onChange(notes.map((note) => note.id === editingNote.id ? { ...note, annotation: editingAnnotation.trim() } : note));
    closePopover();
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => next ? setOpen(true) : closePopover()} modal={false}>
      <span className="composer-selection-notes">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="composer-selection-notes__trigger"
            aria-label={t("selection.viewNotes", { count: notes.length })}
            aria-controls={listId}
            onMouseEnter={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            <MessageSquareText size={13} aria-hidden="true" />
            <span>{t("selection.noteCount", { count: notes.length })}</span>
          </button>
        </Popover.Trigger>
        <button
          type="button"
          className="composer-selection-notes__clear"
          aria-label={t("selection.clearNotes")}
          title={t("selection.clearNotes")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange([]);
            setOpen(false);
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </span>
      <Popover.Portal>
        <Popover.Content
          id={listId}
          className={`${editingNote ? "selection-note-capture" : "selection-notes-popover"} nodrag`}
          data-selection-note-popup="true"
          side="top"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {editingNote ? (
            <SelectionNoteEditor
              selectedText={editingNote.text}
              annotation={editingAnnotation}
              textareaId={`${listId}-edit`}
              onAnnotationChange={setEditingAnnotation}
              onCancel={closePopover}
              onConfirm={saveEdit}
            />
          ) : (
            <>
              <div className="selection-notes-popover__title">{t("selection.pendingNotes")}</div>
              <div className="selection-notes-popover__list">
                {notes.map((note, index) => (
                  <div className="selection-note-row" key={note.id}>
                    <div className="selection-note-row__head">
                      <span className="selection-note-row__index">{index + 1}.</span>
                      <div className="selection-note-row__actions">
                        <button
                          type="button"
                          className="selection-note-row__edit"
                          aria-label={t("selection.editNote", { index: index + 1 })}
                          title={t("selection.editNote", { index: index + 1 })}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => editNote(note)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="selection-note-row__remove"
                          aria-label={t("selection.deleteNote", { index: index + 1 })}
                          title={t("selection.deleteNote", { index: index + 1 })}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            onChange(notes.filter((candidate) => candidate.id !== note.id));
                            closePopover();
                          }}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="selection-note-row__label">{t("selection.selectedText")}</div>
                    <blockquote>{note.text}</blockquote>
                    {note.annotation && <div className="selection-note-row__annotation"><span>{t("selection.annotationLabel")}：</span>{note.annotation}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function addSelectionContextNote(notes: SelectionContextNote[], text: string, annotation: string): SelectionContextNote[] {
  const note = createSelectionContextNote(text, annotation);
  return note ? [...notes, note] : notes;
}
