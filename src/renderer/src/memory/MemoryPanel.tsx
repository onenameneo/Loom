import { useState, type FormEvent } from "react";
import { Brain, Check, RefreshCw, Trash2, X } from "lucide-react";
import type { ProjectMeta } from "../env";
import { ConfirmDialog, Modal, Tip } from "../ui/dialogs";
import { LoomSelect, LoomSelectItem } from "../ui/controls";
import { buttonClassName, cn, fieldClassName, iconButtonClassName } from "../ui/styles";
import { useI18n } from "../i18n/I18nProvider";
import { useMemoryManagement } from "./useMemoryManagement";
import type { MemoryRecord, MemoryRecordType } from "./memoryDomain";

const TYPE_LABEL: Record<MemoryRecordType, string> = {
  user: "用户",
  feedback: "反馈",
  project: "项目",
  reference: "参考",
};

const TYPE_KEY: Record<MemoryRecord["type"], "memory.userType" | "memory.feedbackType" | "memory.projectType" | "memory.referenceType"> = {
  user: "memory.userType",
  feedback: "memory.feedbackType",
  project: "memory.projectType",
  reference: "memory.referenceType",
};

const STATUS_LABEL: Record<MemoryRecord["status"], string> = {
  active: "active",
  candidate: "candidate",
  rejected: "rejected",
  archived: "archived",
  stale: "stale",
  conflicted: "conflict",
};

const STATUS_DOT_CLASS: Record<MemoryRecord["status"], string> = {
  active: "bg-loom-ok",
  candidate: "bg-loom-warn",
  rejected: "bg-loom-err",
  archived: "bg-loom-muted",
  stale: "bg-loom-warn",
  conflicted: "bg-loom-err",
};

const STATUS_PILL_CLASS: Record<MemoryRecord["status"], string> = {
  active: "text-loom-ok",
  candidate: "text-loom-warn",
  rejected: "text-loom-faint",
  archived: "text-loom-faint",
  stale: "text-loom-warn",
  conflicted: "text-loom-err",
};

export function MemoryManagementPanel({ project, enabled = true, autoDreamEnabled = enabled }: { project?: ProjectMeta; enabled?: boolean; autoDreamEnabled?: boolean }) {
  const { t } = useI18n();
  const management = useMemoryManagement({ projectId: project?.id, enabled, autoDreamEnabled });
  const {
    records,
    visibleRecords: visible,
    stats,
    selected,
    selectedId,
    setSelectedId,
    filter,
    setFilter,
    loading,
    error,
    mutationError,
    mutating,
    reload,
    approve,
    reject,
    archive,
    forget,
    edit,
    restore,
    purge,
    remember,
    dreaming,
    dreamStatus,
    autoDreamDisabled,
    runAutoDream,
    cancelAutoDream,
  } = management;
  const [forgetting, setForgetting] = useState<MemoryRecord | null>(null);
  const [forgetMode, setForgetMode] = useState<"archive" | "forget" | "purge">("forget");
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const [rememberError, setRememberError] = useState<string | null>(null);
  const [quickContent, setQuickContent] = useState("");
  const [quickType, setQuickType] = useState<MemoryRecordType>("user");

  async function quickRemember(): Promise<boolean> {
    const content = quickContent.trim();
    if (!content || !window.api?.memory) return false;
    const saved = await remember({
      type: quickType,
      scope: quickType === "project" && project ? { kind: "project", projectId: project.id } : { kind: "user" },
      description: content.length > 64 ? `${content.slice(0, 61)}...` : content,
      content,
      source: { trigger: "explicit" },
    });
    if (saved) setQuickContent("");
    return saved;
  }

  async function submitRemember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = quickContent.trim();
    if (!content || remembering || !window.api?.memory) return;
    setRemembering(true);
    setRememberError(null);
    try {
      const saved = await quickRemember();
      if (saved) setAddOpen(false);
      else setRememberError(mutationError ?? t("memory.saveFailed"));
    } catch (error) {
      setRememberError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemembering(false);
    }
  }

  function openEdit(record: MemoryRecord) {
    setEditError(null);
    setEditDescription(record.description);
    setEditContent(record.content);
    setEditing(record);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const description = editDescription.trim();
    const content = editContent.trim();
    if (!description || !content) {
      setEditError(t("memory.editValidation"));
      return;
    }
    setEditingBusy(true);
    setEditError(null);
    const saved = await edit(editing.id, { description, content });
    if (saved) setEditing(null);
    else setEditError(mutationError ?? t("memory.editFailed"));
    setEditingBusy(false);
  }

  async function confirmForget() {
    if (!forgetting) return;
    const saved = await forget(forgetting.id, "forgotten from memory settings");
    if (saved) {
      setSelectedId(null);
      setForgetting(null);
    }
  }

  async function confirmArchive() {
    if (!forgetting) return;
    const saved = await archive(forgetting.id, "archived from memory settings");
    if (saved) {
      setSelectedId(null);
      setForgetting(null);
    }
  }

  async function confirmPurge() {
    if (!forgetting) return;
    const saved = await purge(forgetting.id);
    if (saved) {
      setSelectedId(null);
      setForgetting(null);
    }
  }

  function dreamStatusText() {
    const status = dreamStatus;
    if (dreaming) {
      const phaseKeys: Record<string, "memory.phaseOrient" | "memory.phaseGather" | "memory.phaseConsolidate" | "memory.phasePrune" | "memory.phaseCompleted" | "memory.phaseFailed" | "memory.phaseCancelled"> = {
        orient: "memory.phaseOrient",
        gather: "memory.phaseGather",
        consolidate: "memory.phaseConsolidate",
        prune: "memory.phasePrune",
        completed: "memory.phaseCompleted",
        failed: "memory.phaseFailed",
        cancelled: "memory.phaseCancelled",
      };
      const phase = status.phase && phaseKeys[status.phase] ? t(phaseKeys[status.phase]) : t("memory.running");
      return `${phase} · ${Math.round((status.progress ?? 0) * 100)}%`;
    }
    if (status.status === "checking") return t("memory.checking");
    if (status.status === "completed") return t("memory.completedCount", { count: status.changedCount ?? 0 });
    if (status.status === "failed") return t("memory.failedRetry", { error: status.lastError ?? t("memory.retry") });
    if (status.status === "cancelled") return t("memory.cancelledRun");
    if (status.gate && !status.gate.eligible) {
      if (status.gate.reason === "disabled") return t("memory.disabledGate");
      if (status.gate.reason === "sessions") return t("memory.sessionsGate", { count: status.newSessions ?? 0 });
      if (status.gate.reason === "interval" || status.gate.reason === "throttled") {
        return status.gate.nextEligibleAt ? t("memory.nextRun", { time: new Date(status.gate.nextEligibleAt).toLocaleString() }) : t("memory.cooldown");
      }
      if (status.gate.reason === "locked") return t("memory.locked");
    }
    return t("memory.defaultDream");
  }

  return (
    <div className="memory-management min-w-0">
      <header className="settings-toolbar settings-toolbar--settings memory-management__toolbar flex max-[820px]:flex-col max-[820px]:items-start">
        <div>
          <div className="inline-flex items-center gap-[6px] font-loom-mono text-[10px] tracking-[.04em] text-loom-muted"><Brain size={13} /> CROSS-SESSION MEMORY</div>
          <h2 className="mb-loom-1 mt-loom-2 text-[18px] font-semibold tracking-[-.02em]">{t("memory.title")}</h2>
          <p className="m-0 text-[12px] text-loom-muted">{t("memory.subtitle")}</p>
        </div>
        <div className="memory-management__actions max-[820px]:w-full">
          <button className={iconButtonClassName("default", "h-9 w-9")} type="button" onClick={() => void reload()} disabled={loading || mutating} title={t("memory.refresh")} aria-label={t("memory.refresh")}><RefreshCw size={16} /></button>
          <button className={buttonClassName("primary")} type="button" onClick={() => { setRememberError(null); setAddOpen(true); }} disabled={mutating}>{t("memory.add")}</button>
          <div className="memory-management__autodream">
            <div className="memory-management__autodream-row">
              <Tip label={dreamStatusText()}>
                <span className="inline-flex">
                  <button className={buttonClassName("default", "justify-center whitespace-nowrap")} type="button" onClick={() => void runAutoDream()} disabled={autoDreamDisabled}>{dreaming ? t("memory.running") : t("memory.runAutoDream")}</button>
                </span>
              </Tip>
              {dreaming && <button className={buttonClassName("default")} type="button" onClick={() => void cancelAutoDream()}>{t("memory.cancel")}</button>}
            </div>
            {dreaming && <div className="h-[3px] overflow-hidden rounded-loom-pill bg-loom-surface-2" aria-hidden="true"><span className="block h-full rounded-[inherit] bg-loom-accent transition-[width] duration-200 ease-loom" style={{ width: `${Math.max(4, Math.round((dreamStatus.progress ?? 0) * 100))}%` }} /></div>}
          </div>
        </div>
      </header>

      {!enabled && <div className="mb-loom-4 rounded-loom-sm border border-loom-warn/30 bg-loom-warn/10 px-loom-3 py-loom-2 text-[12px] text-loom-muted" role="status">{t("settings.memoryDisabledManagement")}</div>}
      {(error || mutationError) && <div className="mb-loom-4 rounded-loom-sm border border-loom-err/30 bg-loom-err/10 px-loom-3 py-loom-2 text-[12px] text-loom-err" role="alert">{error ?? mutationError}</div>}

      <div className="mx-auto mt-loom-5 flex max-w-[1100px] items-center justify-between pb-loom-2">
        <div className="flex flex-wrap items-center gap-loom-3" role="tablist" aria-label={t("memory.stats")}>
          {(["all", "candidate", "active", "archived"] as const).map((item) => {
            const label = item === "all" ? t("memory.all") : item;
            const count = item === "all" ? records.length : stats[item === "candidate" ? "candidates" : item];
            return <button key={item} className={cn("inline-flex h-8 items-center gap-loom-1 rounded-loom-sm border-0 bg-transparent px-[10px] font-loom-mono text-[11px] text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text", filter === item && "bg-loom-surface-2 text-loom-text")} role="tab" aria-label={`${label} ${count}`} aria-selected={filter === item} type="button" onClick={() => setFilter(item)}><span>{label}</span><strong className="font-semibold text-loom-text">{count}</strong></button>;
          })}
          {(stats.stale > 0 || stats.conflicted > 0 || stats.issues > 0) && <span className="font-loom-mono text-[10px] text-loom-faint">{stats.stale > 0 && `stale ${stats.stale}`} {stats.conflicted > 0 && `conflicts ${stats.conflicted}`} {stats.issues > 0 && `${stats.issues} ${t("memory.issues")}`}</span>}
        </div>
        <span className="font-loom-mono text-[10px] text-loom-faint">{project ? `${t("memory.projectScope")} · ${project.name}` : t("memory.userScope")}</span>
      </div>

      <div className="mx-auto grid min-h-[320px] max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-loom-3">
        <div className="min-h-[320px] min-w-0 self-start overflow-hidden rounded-loom-lg border border-loom-border bg-loom-surface" aria-live="polite">
          {visible.map((record) => (
            <button key={record.id} type="button" className={cn("flex min-h-16 w-full items-center gap-loom-3 border-0 border-b border-loom-border bg-transparent px-loom-4 py-loom-3 text-left text-loom-text hover:bg-loom-surface-2", record.id === selectedId && "bg-loom-surface-2", visible.at(-1)?.id === record.id && "border-b-0")} onClick={() => setSelectedId(record.id)}>
              <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", STATUS_DOT_CLASS[record.status])} />
              <span className="grid min-w-0 flex-1 gap-[3px]"><strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium">{record.description}</strong><small className="overflow-hidden text-ellipsis whitespace-nowrap font-loom-mono text-[10px] text-loom-faint">{t(TYPE_KEY[record.type])} · {record.scope.kind === "project" ? t("memory.projectScope") : t("memory.userScope")} · {record.id}</small></span>
              <span className={cn("shrink-0 rounded-loom-pill bg-loom-surface-2 px-[6px] py-[3px] font-loom-mono text-[9px]", STATUS_PILL_CLASS[record.status])}>{STATUS_LABEL[record.status]}</span>
            </button>
          ))}
          {visible.length === 0 && <div className="p-loom-6 text-center text-[12px] text-loom-muted">{t("memory.noMatches")}</div>}
        </div>
      </div>
      <Modal open={addOpen} onOpenChange={setAddOpen} ariaLabel={t("memory.addTitle")}>
        <form className="settings-modal__panel memory-add-dialog w-[min(560px,calc(100vw-48px))] p-loom-6 max-[820px]:p-loom-5" onSubmit={(event) => void submitRemember(event)}>
          <div className="mb-loom-5 flex items-start justify-between gap-loom-4">
            <div>
              <h2 className="m-0 text-[20px] leading-[1.4]">{t("memory.addTitle")}</h2>
              <p className="mt-loom-1 mb-0 max-w-[420px] text-[12.5px] leading-[1.6] text-loom-muted">{t("memory.addDescription")}</p>
            </div>
            <button className={iconButtonClassName()} type="button" onClick={() => setAddOpen(false)} aria-label={t("memory.closeAdd")} title={t("common.cancel")}><X size={16} /></button>
          </div>
          <div className="grid gap-loom-4">
            <label className="mb-0 flex flex-col gap-[6px]">
              <span>{t("memory.type")}</span>
              <LoomSelect value={quickType} onValueChange={(value) => setQuickType(value as MemoryRecord["type"])} placeholder={t("memory.chooseType")} ariaLabel={t("memory.type")}>
                {(Object.keys(TYPE_LABEL) as MemoryRecord["type"][]).map((type) => <LoomSelectItem key={type} value={type}>{t(TYPE_KEY[type])}</LoomSelectItem>)}
              </LoomSelect>
            </label>
            <label className="mb-0 flex flex-col gap-[6px]">
              <span>{t("memory.content")}</span>
              <textarea className={cn(fieldClassName, "min-h-[144px] resize-y px-3 py-[11px] leading-[1.65]")} autoFocus value={quickContent} onChange={(event) => setQuickContent(event.target.value)} placeholder={t("memory.contentPlaceholder")} rows={6} />
              <small className="font-loom-mono text-[10.5px] leading-[1.5] text-loom-faint">{t("memory.contentHint")}</small>
            </label>
            {rememberError && <div className="rounded-loom-sm border border-loom-err/30 bg-loom-err/10 px-loom-3 py-loom-2 text-[12px] text-loom-err" role="alert">{rememberError}</div>}
          </div>
          <div className="mt-loom-6 flex justify-end gap-loom-2 border-t border-loom-border pt-loom-4">
            <button className={buttonClassName()} type="button" onClick={() => setAddOpen(false)}>{t("memory.cancel")}</button>
            <button className={buttonClassName("primary")} type="submit" disabled={remembering || !quickContent.trim()}>{remembering ? t("memory.saving") : t("memory.addMemory")}</button>
          </div>
        </form>
      </Modal>
      <Modal open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }} ariaLabel={t("memory.editTitle")}>
        {editing && (
          <form className="settings-modal__panel memory-edit-dialog w-[min(640px,calc(100vw-48px))] p-loom-6 max-[820px]:p-loom-5" onSubmit={(event) => void submitEdit(event)}>
            <div className="mb-loom-5 flex items-start justify-between gap-loom-4">
              <div><h2 className="m-0 text-[20px] leading-[1.4]">{t("memory.editTitle")}</h2><p className="mt-loom-1 mb-0 text-[12.5px] leading-[1.6] text-loom-muted">{t("memory.editDescription")}</p></div>
              <button className={iconButtonClassName()} type="button" onClick={() => setEditing(null)} aria-label={t("memory.closeEdit")} title={t("common.cancel")}><X size={16} /></button>
            </div>
            <div className="grid gap-loom-4">
              <label className="mb-0 flex flex-col gap-[6px]"><span>{t("memory.description")}</span><input className={fieldClassName} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
              <label className="mb-0 flex flex-col gap-[6px]"><span>{t("memory.content")}</span><textarea className={cn(fieldClassName, "min-h-[144px] resize-y px-3 py-[11px] leading-[1.65]")} value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={6} /></label>
              {editError && <div className="rounded-loom-sm border border-loom-err/30 bg-loom-err/10 px-loom-3 py-loom-2 text-[12px] text-loom-err" role="alert">{editError}</div>}
            </div>
            <div className="mt-loom-6 flex justify-end gap-loom-2 border-t border-loom-border pt-loom-4"><button className={buttonClassName()} type="button" onClick={() => setEditing(null)}>{t("memory.cancel")}</button><button className={buttonClassName("primary")} type="submit" disabled={editingBusy || !editDescription.trim() || !editContent.trim()}>{editingBusy ? t("memory.saving") : t("memory.saveEdit")}</button></div>
          </form>
        )}
      </Modal>
      <Modal open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }} ariaLabel={t("memory.detail")}>
        {selected && (
          <div className="settings-modal__panel memory-detail-dialog w-[min(640px,calc(100vw-48px))] p-loom-4">
            <div className="flex justify-between gap-loom-3">
              <div><span className="inline-flex items-center gap-[6px] font-loom-mono text-[10px] tracking-[.04em] text-loom-muted">{t(TYPE_KEY[selected.type])} · {selected.status}</span><h2 className="mt-loom-2 mb-0 text-[18px] font-semibold leading-[1.45]">{selected.description}</h2></div>
              <button className={iconButtonClassName()} type="button" onClick={() => setSelectedId(null)} aria-label={t("memory.closeDetail")} title={t("memory.closeDetail")}><X size={16} /></button>
            </div>
            <p className="my-loom-5 whitespace-pre-wrap text-[13px] leading-[1.7] text-loom-text">{selected.content}</p>
            <dl className="grid grid-cols-3 gap-loom-2 m-0"><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">confidence</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{Math.round(selected.confidence * 100)}%</dd></div><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">source</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{selected.source.trigger}</dd></div><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">updated</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{new Date(selected.updatedAt).toLocaleString()}</dd></div></dl>
            {selected.source.excerpt && <blockquote className="my-loom-4 border-l-2 border-loom-accent pl-loom-3 text-[11px] leading-[1.6] text-loom-muted">{selected.source.excerpt}</blockquote>}
            <div className="mt-loom-5 flex flex-wrap items-center gap-loom-2">
              <button className={buttonClassName()} type="button" onClick={() => openEdit(selected)} disabled={mutating}>{t("memory.edit")}</button>
              {selected.status === "candidate" && <><button className={buttonClassName("primary")} type="button" onClick={() => void approve(selected.id)} disabled={mutating}><Check size={14} /> {t("memory.approved")}</button><button className={buttonClassName()} type="button" onClick={() => void reject(selected.id)} disabled={mutating}>{t("memory.rejected")}</button></>}
              {selected.status !== "archived" && selected.status !== "rejected" && <><button className={buttonClassName()} type="button" onClick={() => { setForgetMode("archive"); setForgetting(selected); }} disabled={mutating}>{t("memory.archiveAction")}</button><button className={iconButtonClassName("danger")} type="button" onClick={() => { setForgetMode("forget"); setForgetting(selected); }} disabled={mutating} aria-label={t("memory.forgetAction")} title={t("memory.forgetAction")}><Trash2 size={16} /></button></>}
              {(selected.status === "archived" || selected.status === "rejected") && <><button className={buttonClassName("primary")} type="button" onClick={() => void restore(selected.id)} disabled={mutating}><Check size={14} /> {t("memory.restore")}</button><button className={buttonClassName("danger")} type="button" onClick={() => { setForgetMode("purge"); setForgetting(selected); }} disabled={mutating}><Trash2 size={14} /> {t("memory.permanentlyDelete")}</button></>}
              {mutationError && <div className="w-full text-[12px] text-loom-err" role="alert">{mutationError}</div>}
              {(selected.status === "archived" || selected.status === "rejected") && <span className="text-[11px] text-loom-muted">{t("memory.restoreHint")}</span>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(forgetting)} onOpenChange={(open) => { if (!open) setForgetting(null); }} title={forgetMode === "archive" ? t("memory.archiveTitle") : forgetMode === "purge" ? t("memory.purgeTitle") : t("memory.forgetTitle")} description={forgetting ? t(forgetMode === "archive" ? "memory.archiveDescription" : forgetMode === "purge" ? "memory.purgeDescription" : "memory.forgetDescription", { description: forgetting.description }) : undefined} confirmLabel={forgetMode === "purge" ? t("memory.permanentlyDelete") : undefined} error={mutationError} confirmDisabled={mutating} onConfirm={() => void (forgetMode === "archive" ? confirmArchive() : forgetMode === "purge" ? confirmPurge() : confirmForget())} />
    </div>
  );
}

export default MemoryManagementPanel;
