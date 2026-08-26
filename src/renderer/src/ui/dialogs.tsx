import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertDialog, Dialog, Popover, Tooltip } from "radix-ui";
import { Folder, FolderPlus, GitBranch, MessageSquarePlus, X } from "lucide-react";
import { IconProject } from "../icons";
import { buttonClassName, cn, dialogActionsClassName, dialogDescriptionClassName, dialogTitleClassName, fieldClassName } from "./styles";
import { useI18n } from "../i18n/I18nProvider";

// Radix Primitives（无样式、可访问）+ DESIGN.md token 样式。见 shell.css .dlg-*/.tip。

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  error,
  confirmDisabled = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  error?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [displayDescription, setDisplayDescription] = useState<ReactNode>(description);
  useEffect(() => {
    if (open) setDisplayDescription(description);
  }, [open, description]);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <AlertDialog.Content forceMount className="dlg-content" aria-hidden={!open}>
          <AlertDialog.Title className={cn("dlg-title", dialogTitleClassName)}>{title}</AlertDialog.Title>
          {displayDescription && (
            <AlertDialog.Description asChild>
              <div className={cn("dlg-desc", dialogDescriptionClassName)}>{displayDescription}</div>
            </AlertDialog.Description>
          )}
          {error && <div className="dlg-error" role="alert">{error}</div>}
          <div className={cn("dlg-actions", dialogActionsClassName)}>
            <AlertDialog.Cancel asChild>
              <button className={buttonClassName()} onClick={() => onOpenChange(false)}>{t("common.cancel")}</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button className={buttonClassName("danger")} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel ?? t("nav.delete")}</button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Shared animated modal shell for settings and other content-heavy dialogs. */
export function Modal({
  open,
  onOpenChange,
  ariaLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <Dialog.Content forceMount className="settings-dialog-content" aria-label={ariaLabel} aria-hidden={!open}>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type MessageBranchMode = "new-session" | "canvas-node";

export function MessageBranchDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: MessageBranchMode) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (open) {
      busyRef.current = false;
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const choose = async (mode: MessageBranchMode) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSelect(mode);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dialog.branchFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!busyRef.current) onOpenChange(nextOpen);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <Dialog.Content
          forceMount
          className="dlg-content branch-dialog"
          aria-hidden={!open}
          aria-label={t("dialog.createBranch")}
          onEscapeKeyDown={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
        >
          <Dialog.Title className={cn("dlg-title", dialogTitleClassName)}>{t("dialog.createBranch")}</Dialog.Title>
          <Dialog.Description className={cn("dlg-desc", dialogDescriptionClassName)}>
            {t("dialog.branchDescription")}
          </Dialog.Description>
          <div className="branch-dialog-options">
            <button
              className="branch-dialog-option"
              type="button"
              aria-label={t("dialog.currentWindowBranch")}
              disabled={busy}
              onClick={() => void choose("new-session")}
            >
              <MessageSquarePlus size={17} aria-hidden="true" />
              <span>
                <strong>{t("dialog.currentWindowBranch")}</strong>
                <small>{t("dialog.currentWindowBranchHelp")}</small>
              </span>
            </button>
            <button
              className="branch-dialog-option"
              type="button"
              aria-label={t("dialog.canvasBranch")}
              disabled={busy}
              onClick={() => void choose("canvas-node")}
            >
              <GitBranch size={17} aria-hidden="true" />
              <span>
                <strong>{t("dialog.canvasBranch")}</strong>
                <small>{t("dialog.canvasBranchHelp")}</small>
              </span>
            </button>
          </div>
          {error && <p className="branch-dialog-error" role="alert">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RenameDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  initial: string;
  onSubmit: (name: string) => void;
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);

  const submit = () => {
    const name = v.trim();
    if (name) onSubmit(name);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <Dialog.Content forceMount className="dlg-content" aria-hidden={!open}>
          <Dialog.Title className={cn("dlg-title", dialogTitleClassName)}>{title ?? t("dialog.renameSession")}</Dialog.Title>
          <input
            className={cn("dlg-input", fieldClassName)}
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <div className={cn("dlg-actions", dialogActionsClassName)}>
            <Dialog.Close asChild>
            <button className={buttonClassName()}>{t("dialog.cancel")}</button>
            </Dialog.Close>
            <button className={buttonClassName("primary")} onClick={submit}>{t("dialog.save")}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onPickFolder,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPickFolder: () => Promise<string | undefined>;
  onSubmit: (input: { name: string; sourceRoots: string[] }) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [sourceRoots, setSourceRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nameId = useId();
  const directoryTitleId = useId();
  const directoryHelpId = useId();
  const pickErrorId = useId();
  const submitErrorId = useId();
  const previousOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const pickRequestRef = useRef(0);

  if (open !== previousOpenRef.current) {
    pickRequestRef.current += 1;
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else {
      restoreFocusRef.current = true;
    }
    previousOpenRef.current = open;
  }

  useEffect(() => {
    if (!open) return;
    setName("");
    setSourceRoots([]);
    busyRef.current = false;
    setBusy(false);
    setPicking(false);
    setPickError(null);
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (open || !restoreFocusRef.current || !returnFocusRef.current?.isConnected) return;
    restoreFocusRef.current = false;
    returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [open]);

  const addFolder = async () => {
    if (busy || picking) return;
    const requestId = ++pickRequestRef.current;
    setPickError(null);
    setPicking(true);
    try {
      const path = await onPickFolder();
      if (requestId !== pickRequestRef.current) return;
      if (!path) return;
      setSourceRoots((current) => (current.includes(path) ? current : [...current, path]));
      setName((current) => current || path.split(/[\\/]/).filter(Boolean).at(-1) || "");
    } catch (error) {
      if (requestId !== pickRequestRef.current) return;
      setPickError(error instanceof Error ? error.message : t("dialog.addDirectory"));
    } finally {
      if (requestId === pickRequestRef.current) setPicking(false);
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit({ name: trimmed, sourceRoots });
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("dialog.createProject"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!busyRef.current) onOpenChange(nextOpen);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <Dialog.Content
          forceMount
          className="dlg-content project-create-dialog"
          aria-hidden={!open}
          onEscapeKeyDown={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
        >
          <div className="project-dialog-head">
            <span className="project-dialog-icon" aria-hidden="true">
              <IconProject size={17} />
            </span>
            <div className="project-dialog-heading">
              <Dialog.Title className={cn("dlg-title", dialogTitleClassName)}>{t("dialog.createProject")}</Dialog.Title>
              <Dialog.Description className={cn("dlg-desc", dialogDescriptionClassName, "project-dialog-description")}>
                {t("dialog.createDescription")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="project-dialog-close" type="button" aria-label={t("dialog.close")} disabled={busy}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <form className="project-dialog-form" onSubmit={handleSubmit}>
            <div className="project-dialog-body">
              <div className="project-name-field">
                <label htmlFor={nameId}>{t("dialog.projectName")}</label>
                <input
                  id={nameId}
                  autoFocus
                  required
                  disabled={busy}
                  placeholder={t("dialog.projectNamePlaceholder")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <section className="project-source-section" aria-labelledby={directoryTitleId}>
                <h3 className="project-source-title" id={directoryTitleId}>{t("dialog.projectDirectory")}</h3>
                <button
                  className="project-source-drop"
                  type="button"
                  aria-label={t("dialog.addDirectory")}
                  aria-describedby={`${directoryHelpId}${pickError ? ` ${pickErrorId}` : ""}`}
                  onClick={addFolder}
                  disabled={picking || busy}
                >
                  <FolderPlus size={16} />
                  <span className="project-source-copy">
                    <strong>{picking ? t("dialog.openingPicker") : t("dialog.addDirectory")}</strong>
                    <small id={directoryHelpId}>{t("dialog.directoryHelp")}</small>
                  </span>
                </button>
                {pickError && <div className="project-source-error" id={pickErrorId} role="alert">{pickError}</div>}
                {sourceRoots.length > 0 && (
                  <div className="project-source-list">
                    {sourceRoots.map((folder) => (
                      <div className="project-source-row" key={folder} title={folder}>
                        <Folder size={14} />
                        <span>{folder}</span>
                        <button
                          type="button"
                          aria-label={t("dialog.removeDirectory", { folder })}
                          disabled={busy}
                          onClick={() => setSourceRoots((current) => current.filter((item) => item !== folder))}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {submitError && <div className="project-submit-error" id={submitErrorId} role="alert">{submitError}</div>}
            </div>
            <div className={cn("dlg-actions", dialogActionsClassName, "project-dialog-actions")}>
              <Dialog.Close asChild>
                <button className={buttonClassName("default", "min-w-[84px] h-9 justify-center py-0")} type="button" disabled={busy}>{t("dialog.cancel")}</button>
              </Dialog.Close>
              <button
                className={buttonClassName("primary", "min-w-[84px] h-9 justify-center py-0")}
                type="submit"
                aria-describedby={submitError ? submitErrorId : undefined}
                disabled={!name.trim() || busy || picking}
              >
                {busy ? t("dialog.creating") : t("dialog.createProject")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" sideOffset={6}>
            {label}
            <Tooltip.Arrow className="tip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function ClickTip({
  label,
  children,
  content,
  className = "click-tip",
  side = "bottom",
  align = "end",
  sideOffset = 8,
}: {
  label: string;
  children: ReactNode;
  content: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  const descriptionId = useId();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={className}
          aria-label={label}
          aria-describedby={descriptionId}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <span id={descriptionId}>{content}</span>
          <Popover.Arrow className="click-tip-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
