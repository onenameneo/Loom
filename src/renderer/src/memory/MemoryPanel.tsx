import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Brain, Check, RefreshCw, Trash2, X } from "lucide-react";
import type { ProjectMeta } from "../env";
import { ConfirmDialog, Modal, Tip } from "../ui/dialogs";
import { LoomSelect, LoomSelectItem } from "../ui/controls";
import { buttonClassName, cn, fieldClassName, iconButtonClassName } from "../ui/styles";

type MemoryRecord = {
  id: string;
  type: "user" | "feedback" | "project" | "reference";
  scope: { kind: "user" } | { kind: "project"; projectId: string };
  status: "active" | "candidate" | "rejected" | "archived" | "stale" | "conflicted";
  confidence: number;
  description: string;
  content: string;
  source: { trigger: string; sessionId?: string; nodeId?: string; excerpt?: string };
  updatedAt: number;
  archivedReason?: string;
};

type AutoDreamStatus = {
  status?: "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "checking";
  phase?: string;
  progress?: number;
  newSessions?: number;
  changedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  lastError?: string;
  gate?: { eligible: boolean; reason: "disabled" | "interval" | "sessions" | "throttled" | "locked" | "ready"; nextEligibleAt?: number };
};

const DREAM_PHASE_LABEL: Record<string, string> = {
  orient: "检查记忆",
  gather: "收集记忆",
  consolidate: "整理关联",
  prune: "清理旧内容",
  completed: "整理完成",
  failed: "整理失败",
  cancelled: "已取消",
};

const TYPE_LABEL: Record<MemoryRecord["type"], string> = {
  user: "用户",
  feedback: "反馈",
  project: "项目",
  reference: "参考",
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

export default function MemoryPanel({ project }: { project?: ProjectMeta }) {
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [stats, setStats] = useState({ active: 0, candidates: 0, archived: 0, stale: 0, conflicted: 0, issues: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "candidate" | "active" | "archived">("all");
  const [loading, setLoading] = useState(false);
  const [dreaming, setDreaming] = useState(false);
  const [dreamStatus, setDreamStatus] = useState<AutoDreamStatus>({ status: "idle" });
  const [forgetting, setForgetting] = useState<MemoryRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const [rememberError, setRememberError] = useState<string | null>(null);
  const [quickContent, setQuickContent] = useState("");
  const [quickType, setQuickType] = useState<MemoryRecord["type"]>("user");

  const reload = useCallback(async () => {
    if (!window.api?.memory) return;
    setLoading(true);
    try {
      const result = await window.api.memory.list({ projectId: project?.id, includeArchived: true });
      setRecords(result.records as MemoryRecord[]);
      setStats(result.stats);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  const refreshDreamStatus = useCallback(async () => {
    if (!window.api?.memory?.autodreamStatus) return;
    const status = await window.api.memory.autodreamStatus() as AutoDreamStatus | undefined;
    if (!status) return;
    setDreamStatus(status);
    setDreaming(status.status === "running");
  }, []);

  useEffect(() => {
    void reload();
    void refreshDreamStatus();
    if (!window.api?.memory) return;
    return window.api.memory.onEvent((event) => {
      if (event.type === "autodream") {
        const progress = event.progress as AutoDreamStatus & { summary?: { changed?: string[]; skipped?: string[]; failed?: unknown[] } } | undefined;
        const summary = progress?.summary;
        setDreamStatus((current) => ({
          ...current,
          ...progress,
          ...(summary ? { changedCount: summary.changed?.length ?? 0, skippedCount: summary.skipped?.length ?? 0, failedCount: summary.failed?.length ?? 0 } : {}),
        }));
        if (progress?.phase === "completed" || progress?.phase === "failed" || progress?.phase === "cancelled") {
          setDreaming(false);
          void refreshDreamStatus();
        }
      }
      void reload();
    });
  }, [refreshDreamStatus, reload]);

  const visible = useMemo(() => records.filter((record) => filter === "all" || record.status === filter), [filter, records]);
  const selected = records.find((record) => record.id === selectedId);

  async function approve(record: MemoryRecord) {
    await window.api?.memory.approve(record.id);
    await reload();
  }

  async function reject(record: MemoryRecord) {
    await window.api?.memory.reject(record.id, "rejected from memory center");
    await reload();
  }

  async function archive() {
    if (!forgetting) return;
    await window.api?.memory.forget(forgetting.id, "forgotten from memory center");
    setSelectedId(null);
    setForgetting(null);
    await reload();
  }

  async function runAutoDream() {
    if (!window.api?.memory) return;
    setDreamStatus((current) => ({ ...current, status: "checking", phase: undefined, progress: undefined }));
    try {
      const status = await window.api.memory.autodreamStatus() as AutoDreamStatus | undefined;
      if (!status) return;
      setDreamStatus(status);
      if (status.gate && !status.gate.eligible) return;
      setDreaming(true);
      const summary = await window.api.memory.autodreamRun() as { status?: AutoDreamStatus["status"]; changed?: string[]; skipped?: string[]; failed?: unknown[] } | undefined;
      if (summary) {
        setDreamStatus((current) => ({
          ...current,
          status: summary.status ?? "completed",
          phase: summary.status ?? "completed",
          progress: 1,
          changedCount: summary.changed?.length ?? 0,
          skippedCount: summary.skipped?.length ?? 0,
          failedCount: summary.failed?.length ?? 0,
        }));
      }
      if (!summary) await refreshDreamStatus();
      await reload();
    } catch (error) {
      setDreamStatus((current) => ({ ...current, status: "failed", phase: "failed", lastError: error instanceof Error ? error.message : String(error) }));
    } finally {
      setDreaming(false);
    }
  }

  async function cancelAutoDream() {
    await window.api?.memory.autodreamCancel();
    setDreamStatus((current) => ({ ...current, status: "cancelled", phase: "cancelled" }));
    setDreaming(false);
  }

  async function quickRemember() {
    const content = quickContent.trim();
    if (!content || !window.api?.memory) return;
    await window.api.memory.remember({
      type: quickType,
      scope: quickType === "project" && project ? { kind: "project", projectId: project.id } : { kind: "user" },
      description: content.length > 64 ? `${content.slice(0, 61)}...` : content,
      content,
      source: { trigger: "explicit" },
    });
    setQuickContent("");
    await reload();
  }

  async function submitRemember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = quickContent.trim();
    if (!content || remembering || !window.api?.memory) return;
    setRemembering(true);
    setRememberError(null);
    try {
      await quickRemember();
      setAddOpen(false);
    } catch (error) {
      setRememberError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemembering(false);
    }
  }

  function dreamStatusText() {
    const status = dreamStatus;
    if (dreaming) {
      const phase = DREAM_PHASE_LABEL[status.phase ?? ""] ?? "正在整理";
      return `${phase} · ${Math.round((status.progress ?? 0) * 100)}%`;
    }
    if (status.status === "checking") return "正在检查运行条件…";
    if (status.status === "completed") return `已完成 · 更新 ${status.changedCount ?? 0} 条记忆`;
    if (status.status === "failed") return `运行失败 · ${status.lastError ?? "请稍后重试"}`;
    if (status.status === "cancelled") return "已取消本次整理";
    if (status.gate && !status.gate.eligible) {
      if (status.gate.reason === "disabled") return "未开启 · 请在设置中启用长期记忆和 AutoDream";
      if (status.gate.reason === "sessions") return `暂不可运行 · 已积累 ${status.newSessions ?? 0} 个新会话`;
      if (status.gate.reason === "interval" || status.gate.reason === "throttled") {
        return status.gate.nextEligibleAt ? `暂不可运行 · 下次可运行 ${new Date(status.gate.nextEligibleAt).toLocaleString()}` : "暂不可运行 · 仍在冷却时间内";
      }
      if (status.gate.reason === "locked") return "已有一次整理任务正在运行";
    }
    return "自动整理跨会话记忆";
  }

  const autoDreamDisabled = dreaming || dreamStatus.status === "checking" || Boolean(dreamStatus.gate && !dreamStatus.gate.eligible);

  return (
    <div className="h-full min-w-0 overflow-auto bg-loom-bg p-loom-6 max-[820px]:p-loom-4">
      <header className="mx-auto mb-loom-4 flex max-w-[1100px] items-start justify-between gap-loom-5 max-[820px]:flex-col max-[820px]:gap-loom-4">
        <div>
          <div className="inline-flex items-center gap-[6px] font-loom-mono text-[10px] tracking-[.04em] text-loom-muted"><Brain size={13} /> CROSS-SESSION MEMORY</div>
          <h1 className="mb-loom-1 mt-loom-2 text-[22px] font-semibold tracking-[-.02em]">长期记忆</h1>
          <p className="m-0 text-[12px] text-loom-muted">Markdown 是事实源。候选记忆先观察，再决定是否留下。</p>
        </div>
        <div className="flex items-start gap-loom-2 max-[820px]:w-full max-[820px]:flex-wrap">
          <button className={iconButtonClassName("default", "h-10 w-10")} type="button" onClick={() => void reload()} disabled={loading} title="刷新" aria-label="刷新记忆"><RefreshCw size={16} /></button>
          <button className={buttonClassName("primary", "min-h-10")} type="button" onClick={() => { setRememberError(null); setAddOpen(true); }}>新增记忆</button>
          <div className="grid min-w-0 gap-loom-1 max-[820px]:order-3 max-[820px]:min-w-full">
            <div className="flex gap-loom-2">
              <Tip label={dreamStatusText()}>
                <span className="inline-flex">
                  <button className={buttonClassName("default", "justify-center whitespace-nowrap min-h-10")} type="button" onClick={() => void runAutoDream()} disabled={autoDreamDisabled}>{dreaming ? "整理中…" : "运行 AutoDream"}</button>
                </span>
              </Tip>
              {dreaming && <button className={buttonClassName("default", "min-h-10")} type="button" onClick={() => void cancelAutoDream()}>取消</button>}
            </div>
            {dreaming && <div className="h-[3px] overflow-hidden rounded-loom-pill bg-loom-surface-2" aria-hidden="true"><span className="block h-full rounded-[inherit] bg-loom-accent transition-[width] duration-200 ease-loom" style={{ width: `${Math.max(4, Math.round((dreamStatus.progress ?? 0) * 100))}%` }} /></div>}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1100px] gap-loom-4 border-y border-loom-border py-loom-3 font-loom-mono text-[11px] text-loom-muted" aria-label="记忆统计">
        <span><strong className="font-semibold text-loom-text">{stats.active}</strong> active</span>
        <span className={stats.candidates ? "text-loom-warn" : ""}><strong className="font-semibold text-loom-text">{stats.candidates}</strong> candidates</span>
        <span><strong className="font-semibold text-loom-text">{stats.archived}</strong> archived</span>
        {stats.issues > 0 && <span className="text-loom-err"><strong className="font-semibold text-loom-text">{stats.issues}</strong> 文件问题</span>}
      </div>

      <div className="mx-auto mt-loom-5 flex max-w-[1100px] items-center justify-between pb-loom-2">
        <div className="flex gap-loom-1" role="tablist" aria-label="记忆状态">
          {(["all", "candidate", "active", "archived"] as const).map((item) => <button key={item} className={cn("inline-flex h-8 items-center rounded-loom-sm border-0 bg-transparent px-[10px] font-loom-mono text-[11px] text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text", filter === item && "bg-loom-surface-2 text-loom-text")} type="button" onClick={() => setFilter(item)}>{item === "all" ? "全部" : item}</button>)}
        </div>
        <span className="font-loom-mono text-[10px] text-loom-faint">{project ? `当前项目 · ${project.name}` : "用户级"}</span>
      </div>

      <div className="mx-auto grid min-h-[320px] max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-loom-3">
        <div className="min-h-[320px] min-w-0 self-start overflow-hidden rounded-loom-lg border border-loom-border bg-loom-surface" aria-live="polite">
          {visible.map((record) => (
            <button key={record.id} type="button" className={cn("flex min-h-16 w-full items-center gap-loom-3 border-0 border-b border-loom-border bg-transparent px-loom-4 py-loom-3 text-left text-loom-text hover:bg-loom-surface-2", record.id === selectedId && "bg-loom-surface-2", visible.at(-1)?.id === record.id && "border-b-0")} onClick={() => setSelectedId(record.id)}>
              <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", STATUS_DOT_CLASS[record.status])} />
              <span className="grid min-w-0 flex-1 gap-[3px]"><strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium">{record.description}</strong><small className="overflow-hidden text-ellipsis whitespace-nowrap font-loom-mono text-[10px] text-loom-faint">{TYPE_LABEL[record.type]} · {record.scope.kind === "project" ? "项目" : "用户"} · {record.id}</small></span>
              <span className={cn("shrink-0 rounded-loom-pill bg-loom-surface-2 px-[6px] py-[3px] font-loom-mono text-[9px]", STATUS_PILL_CLASS[record.status])}>{STATUS_LABEL[record.status]}</span>
            </button>
          ))}
          {visible.length === 0 && <div className="p-loom-6 text-center text-[12px] text-loom-muted">还没有符合条件的记忆。</div>}
        </div>
      </div>
      <Modal open={addOpen} onOpenChange={setAddOpen} ariaLabel="新增记忆">
        <form className="settings-modal__panel memory-add-dialog w-[min(560px,calc(100vw-48px))] p-loom-6 max-[820px]:p-loom-5" onSubmit={(event) => void submitRemember(event)}>
          <div className="mb-loom-5 flex items-start justify-between gap-loom-4">
            <div>
              <h2 className="m-0 text-[20px] leading-[1.4]">新增记忆</h2>
              <p className="mt-loom-1 mb-0 max-w-[420px] text-[12.5px] leading-[1.6] text-loom-muted">写下一条希望 Loom 在后续会话中记住的内容。</p>
            </div>
            <button className={iconButtonClassName()} type="button" onClick={() => setAddOpen(false)} aria-label="关闭新增记忆" title="关闭"><X size={16} /></button>
          </div>
          <div className="grid gap-loom-4">
            <label className="mb-0 flex flex-col gap-[6px]">
              <span>记忆类型</span>
              <LoomSelect value={quickType} onValueChange={(value) => setQuickType(value as MemoryRecord["type"])} placeholder="选择类型" ariaLabel="记忆类型">
                {(Object.keys(TYPE_LABEL) as MemoryRecord["type"][]).map((type) => <LoomSelectItem key={type} value={type}>{TYPE_LABEL[type]}</LoomSelectItem>)}
              </LoomSelect>
            </label>
            <label className="mb-0 flex flex-col gap-[6px]">
              <span>记忆内容</span>
              <textarea className={cn(fieldClassName, "min-h-[144px] resize-y px-3 py-[11px] leading-[1.65]")} autoFocus value={quickContent} onChange={(event) => setQuickContent(event.target.value)} placeholder="例如：默认使用中文回答，除非我另有说明。" rows={6} />
              <small className="font-loom-mono text-[10.5px] leading-[1.5] text-loom-faint">尽量写成稳定、可复用的事实或偏好。</small>
            </label>
            {rememberError && <div className="rounded-loom-sm border border-loom-err/30 bg-loom-err/10 px-loom-3 py-loom-2 text-[12px] text-loom-err" role="alert">{rememberError}</div>}
          </div>
          <div className="mt-loom-6 flex justify-end gap-loom-2 border-t border-loom-border pt-loom-4">
            <button className={buttonClassName()} type="button" onClick={() => setAddOpen(false)}>取消</button>
            <button className={buttonClassName("primary")} type="submit" disabled={remembering || !quickContent.trim()}>{remembering ? "保存中…" : "添加记忆"}</button>
          </div>
        </form>
      </Modal>
      <Modal open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }} ariaLabel="记忆详情">
        {selected && (
          <div className="settings-modal__panel memory-detail-dialog w-[min(640px,calc(100vw-48px))] p-loom-4">
            <div className="flex justify-between gap-loom-3">
              <div><span className="inline-flex items-center gap-[6px] font-loom-mono text-[10px] tracking-[.04em] text-loom-muted">{TYPE_LABEL[selected.type]} · {selected.status}</span><h2 className="mt-loom-2 mb-0 text-[18px] font-semibold leading-[1.45]">{selected.description}</h2></div>
              <button className={iconButtonClassName()} type="button" onClick={() => setSelectedId(null)} aria-label="关闭详情" title="关闭详情"><X size={16} /></button>
            </div>
            <p className="my-loom-5 whitespace-pre-wrap text-[13px] leading-[1.7] text-loom-text">{selected.content}</p>
            <dl className="grid grid-cols-3 gap-loom-2 m-0"><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">confidence</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{Math.round(selected.confidence * 100)}%</dd></div><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">source</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{selected.source.trigger}</dd></div><div className="rounded-loom-sm border border-loom-border p-loom-2"><dt className="font-loom-mono text-[9px] text-loom-faint">updated</dt><dd className="m-0 mt-1 font-loom-mono text-[10px] text-loom-text">{new Date(selected.updatedAt).toLocaleString()}</dd></div></dl>
            {selected.source.excerpt && <blockquote className="my-loom-4 border-l-2 border-loom-accent pl-loom-3 text-[11px] leading-[1.6] text-loom-muted">{selected.source.excerpt}</blockquote>}
            <div className="mt-loom-5 flex items-center gap-loom-2">
              {selected.status === "candidate" && <><button className={buttonClassName("primary")} type="button" onClick={() => void approve(selected)}><Check size={14} /> 批准</button><button className={buttonClassName()} type="button" onClick={() => void reject(selected)}>拒绝</button></>}
              {selected.status !== "archived" && selected.status !== "rejected" && <button className={iconButtonClassName("danger")} type="button" onClick={() => setForgetting(selected)} aria-label="遗忘" title="遗忘"><Trash2 size={16} /></button>}
              {selected.status === "archived" && <span className="text-[11px] text-loom-muted">可在 Markdown archive 中恢复</span>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(forgetting)} onOpenChange={(open) => { if (!open) setForgetting(null); }} title="遗忘这条记忆？" description={forgetting ? `“${forgetting.description}”会移出 active，并保留在 archive/ 中。` : undefined} onConfirm={() => void archive()} />
    </div>
  );
}
