import { useEffect, useState, type ReactNode } from "react";
import { AlertDialog, Dialog, Tooltip } from "radix-ui";
import { Folder, FolderPlus, X } from "lucide-react";

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
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dlg-overlay" />
        <AlertDialog.Content className="dlg-content">
          <AlertDialog.Title className="dlg-title">{title}</AlertDialog.Title>
          {description && <AlertDialog.Description className="dlg-desc">{description}</AlertDialog.Description>}
          <div className="dlg-actions">
            <AlertDialog.Cancel asChild>
              <button className="btn">取消</button>
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
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg-content">
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
  onSubmit: (input: { name: string; sourceFolders: string[] }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSourceFolders([]);
    setBusy(false);
    setPicking(false);
    setPickError(null);
  }, [open]);

  const addFolder = async () => {
    setPickError(null);
    setPicking(true);
    try {
      const path = await onPickFolder();
      if (!path) return;
      setSourceFolders((current) => (current.includes(path) ? current : [...current, path]));
      setName((current) => current || path.split("/").filter(Boolean).at(-1) || "");
    } catch (error) {
      setPickError(error instanceof Error ? error.message : "选择文件夹失败");
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onSubmit({ name: trimmed, sourceFolders });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg-content project-create-dialog">
          <div className="project-dialog-head">
            <Dialog.Title className="dlg-title">创建项目</Dialog.Title>
            <Dialog.Close asChild>
              <button className="project-dialog-close" aria-label="关闭">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <label className="project-name-field">
            <span><Folder size={17} /></span>
            <input
              autoFocus
              placeholder="项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
          <div className="project-source-title">Source folders</div>
          <button className="project-source-drop" type="button" onClick={addFolder} disabled={picking}>
            <FolderPlus size={22} />
            <span>{picking ? "正在打开文件夹选择器..." : "添加 Loom 可读取和编辑的文件夹"}</span>
          </button>
          {pickError && <div className="project-source-error">{pickError}</div>}
          {sourceFolders.length > 0 && (
            <div className="project-source-list">
              {sourceFolders.map((folder) => (
                <div className="project-source-row" key={folder} title={folder}>
                  <Folder size={14} />
                  <span>{folder}</span>
                  <button
                    type="button"
                    aria-label="移除文件夹"
                    onClick={() => setSourceFolders((current) => current.filter((item) => item !== folder))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="dlg-actions">
            <Dialog.Close asChild>
              <button className="btn">取消</button>
            </Dialog.Close>
            <button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>创建项目</button>
          </div>
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
