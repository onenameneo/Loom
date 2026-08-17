import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertDialog, Dialog, Popover, Tooltip } from "radix-ui";
import { Folder, FolderPlus, GitBranch, MessageSquarePlus, X } from "lucide-react";
import { IconProject } from "../icons";

// Radix Primitives（无样式、可访问）+ DESIGN.md token 样式。见 shell.css .dlg-*/.tip。

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [displayDescription, setDisplayDescription] = useState(description);
  useEffect(() => {
    if (open) setDisplayDescription(description);
  }, [open, description]);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay forceMount className="dlg-overlay" aria-hidden={!open} />
        <AlertDialog.Content forceMount className="dlg-content" aria-hidden={!open}>
          <AlertDialog.Title className="dlg-title">{title}</AlertDialog.Title>
          {displayDescription && <AlertDialog.Description className="dlg-desc">{displayDescription}</AlertDialog.Description>}
          <div className="dlg-actions">
            <AlertDialog.Cancel asChild>
              <button className="btn" onClick={() => onOpenChange(false)}>取消</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
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
      setError(cause instanceof Error ? cause.message : "创建分支失败");
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
          aria-label="从这里创建聊天分支"
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
          <Dialog.Title className="dlg-title">从这里创建聊天分支</Dialog.Title>
          <Dialog.Description className="dlg-desc">
            保留当前聊天窗口，并选择分支继续的位置。
          </Dialog.Description>
          <div className="branch-dialog-options">
            <button
              className="branch-dialog-option"
              type="button"
              aria-label="在新聊天中继续"
              disabled={busy}
              onClick={() => void choose("new-session")}
            >
              <MessageSquarePlus size={17} aria-hidden="true" />
              <span>
                <strong>在新聊天中继续</strong>
                <small>创建独立会话，复制当前消息之前的上下文</small>
              </span>
            </button>
            <button
              className="branch-dialog-option"
              type="button"
              aria-label="在画布中创建分支"
              disabled={busy}
              onClick={() => void choose("canvas-node")}
            >
              <GitBranch size={17} aria-hidden="true" />
              <span>
                <strong>在画布中创建分支</strong>
                <small>在当前会话生成子节点，冻结当前消息上下文</small>
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
  title = "重命名会话",
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  initial: string;
  onSubmit: (name: string) => void;
}) {
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
          <Dialog.Title className="dlg-title">{title}</Dialog.Title>
          <input
            className="dlg-input"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <div className="dlg-actions">
            <Dialog.Close asChild>
              <button className="btn">取消</button>
            </Dialog.Close>
            <button className="btn primary" onClick={submit}>保存</button>
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
      setPickError(error instanceof Error ? error.message : "选择文件夹失败");
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
      setSubmitError(error instanceof Error ? error.message : "创建项目失败");
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
              <Dialog.Title className="dlg-title">创建项目</Dialog.Title>
              <Dialog.Description className="dlg-desc project-dialog-description">
                为工作内容命名，并按需授权 Loom 访问项目目录。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="project-dialog-close" type="button" aria-label="关闭" disabled={busy}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <form className="project-dialog-form" onSubmit={handleSubmit}>
            <div className="project-dialog-body">
              <div className="project-name-field">
                <label htmlFor={nameId}>项目名称</label>
                <input
                  id={nameId}
                  autoFocus
                  required
                  disabled={busy}
                  placeholder="例如：Loom 桌面端"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <section className="project-source-section" aria-labelledby={directoryTitleId}>
                <h3 className="project-source-title" id={directoryTitleId}>项目目录（可选）</h3>
                <button
                  className="project-source-drop"
                  type="button"
                  aria-label="添加项目目录"
                  aria-describedby={`${directoryHelpId}${pickError ? ` ${pickErrorId}` : ""}`}
                  onClick={addFolder}
                  disabled={picking || busy}
                >
                  <FolderPlus size={16} />
                  <span className="project-source-copy">
                    <strong>{picking ? "正在打开目录选择器..." : "添加项目目录"}</strong>
                    <small id={directoryHelpId}>允许 Loom 在此目录中读取和编辑文件</small>
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
                          aria-label={`移除目录 ${folder}`}
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
            <div className="dlg-actions project-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn" type="button" disabled={busy}>取消</button>
              </Dialog.Close>
              <button
                className="btn primary"
                type="submit"
                aria-describedby={submitError ? submitErrorId : undefined}
                disabled={!name.trim() || busy || picking}
              >
                {busy ? "正在创建..." : "创建项目"}
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
