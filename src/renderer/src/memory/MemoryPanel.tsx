import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Brain, Check, RefreshCw, Trash2, X } from "lucide-react";
import type { ProjectMeta } from "../env";
import { ConfirmDialog, Modal } from "../ui/dialogs";
import { LoomSelect, LoomSelectItem } from "../ui/controls";

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

  const dreamStateClass = dreaming ? "running" : dreamStatus.status === "failed" ? "error" : dreamStatus.status === "completed" ? "success" : dreamStatus.gate && !dreamStatus.gate.eligible ? "blocked" : "";

  return (
    <div className="memory-page">
      <header className="memory-page__header">
        <div>
          <div className="eyebrow"><Brain size={13} /> CROSS-SESSION MEMORY</div>
          <h1>长期记忆</h1>
          <p>Markdown 是事实源。候选记忆先观察，再决定是否留下。</p>
        </div>
        <div className="memory-page__actions">
          <button className="icon-btn" type="button" onClick={() => void reload()} disabled={loading} title="刷新" aria-label="刷新记忆"><RefreshCw size={16} /></button>
          <button className="btn primary" type="button" onClick={() => { setRememberError(null); setAddOpen(true); }}>新增记忆</button>
          <div className="memory-dream-control">
            <div className="memory-dream-control__actions">
              <button className="btn" type="button" onClick={() => void runAutoDream()} disabled={dreaming}>{dreaming ? "整理中…" : "运行 AutoDream"}</button>
              {dreaming && <button className="btn" type="button" onClick={() => void cancelAutoDream()}>取消</button>}
            </div>
            <div className={`memory-dream-status ${dreamStateClass}`} role="status" aria-live="polite">
              <span className="memory-dream-status__dot" aria-hidden="true" />
              <span>{dreamStatusText()}</span>
            </div>
            {dreaming && <div className="memory-dream-progress" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round((dreamStatus.progress ?? 0) * 100))}%` }} /></div>}
          </div>
        </div>
      </header>

      <div className="memory-stats" aria-label="记忆统计">
        <span><strong>{stats.active}</strong> active</span>
        <span className={stats.candidates ? "is-warn" : ""}><strong>{stats.candidates}</strong> candidates</span>
        <span><strong>{stats.archived}</strong> archived</span>
        {stats.issues > 0 && <span className="is-err"><strong>{stats.issues}</strong> 文件问题</span>}
      </div>

      <div className="memory-toolbar">
        <div className="memory-filters" role="tablist" aria-label="记忆状态">
          {(["all", "candidate", "active", "archived"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)}>{item === "all" ? "全部" : item}</button>)}
        </div>
        <span className="memory-scope">{project ? `当前项目 · ${project.name}` : "用户级"}</span>
      </div>

      <div className="memory-layout">
        <div className="memory-list" aria-live="polite">
          {visible.map((record) => (
            <button key={record.id} type="button" className={`memory-card ${record.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(record.id)}>
              <span className={`memory-card__dot status-${record.status}`} />
              <span className="memory-card__main"><strong>{record.description}</strong><small>{TYPE_LABEL[record.type]} · {record.scope.kind === "project" ? "项目" : "用户"} · {record.id}</small></span>
              <span className={`status-pill ${record.status === "active" ? "available" : record.status === "candidate" ? "pending" : "unavailable"}`}>{STATUS_LABEL[record.status]}</span>
            </button>
          ))}
          {visible.length === 0 && <div className="memory-empty">还没有符合条件的记忆。</div>}
        </div>
      </div>
      <Modal open={addOpen} onOpenChange={setAddOpen} ariaLabel="新增记忆">
        <form className="settings-modal__panel memory-add-dialog" onSubmit={(event) => void submitRemember(event)}>
          <div className="memory-add-dialog__head">
            <div>
              <h2>新增记忆</h2>
              <p>写下一条希望 Loom 在后续会话中记住的内容。</p>
            </div>
            <button className="icon-btn" type="button" onClick={() => setAddOpen(false)} aria-label="关闭新增记忆" title="关闭"><X size={16} /></button>
          </div>
          <div className="memory-add-dialog__body">
            <label className="field">
              <span>记忆类型</span>
              <LoomSelect value={quickType} onValueChange={(value) => setQuickType(value as MemoryRecord["type"])} placeholder="选择类型" ariaLabel="记忆类型">
                {(Object.keys(TYPE_LABEL) as MemoryRecord["type"][]).map((type) => <LoomSelectItem key={type} value={type}>{TYPE_LABEL[type]}</LoomSelectItem>)}
              </LoomSelect>
            </label>
            <label className="field memory-content-field">
              <span>记忆内容</span>
              <textarea autoFocus value={quickContent} onChange={(event) => setQuickContent(event.target.value)} placeholder="例如：默认使用中文回答，除非我另有说明。" rows={6} />
              <small>尽量写成稳定、可复用的事实或偏好。</small>
            </label>
            {rememberError && <div className="memory-add-dialog__error" role="alert">{rememberError}</div>}
          </div>
          <div className="memory-add-dialog__actions">
            <button className="btn" type="button" onClick={() => setAddOpen(false)}>取消</button>
            <button className="btn primary" type="submit" disabled={remembering || !quickContent.trim()}>{remembering ? "保存中…" : "添加记忆"}</button>
          </div>
        </form>
      </Modal>
      <Modal open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }} ariaLabel="记忆详情">
        {selected && (
          <div className="settings-modal__panel memory-detail-dialog">
            <div className="memory-detail__head">
              <div><span className="eyebrow">{TYPE_LABEL[selected.type]} · {selected.status}</span><h2>{selected.description}</h2></div>
              <button className="icon-btn" type="button" onClick={() => setSelectedId(null)} aria-label="关闭详情" title="关闭详情"><X size={16} /></button>
            </div>
            <p className="memory-detail__content">{selected.content}</p>
            <dl className="memory-meta"><div><dt>confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div><div><dt>source</dt><dd>{selected.source.trigger}</dd></div><div><dt>updated</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></div></dl>
            {selected.source.excerpt && <blockquote>{selected.source.excerpt}</blockquote>}
            <div className="memory-detail__actions">
              {selected.status === "candidate" && <><button className="btn primary" type="button" onClick={() => void approve(selected)}><Check size={14} /> 批准</button><button className="btn" type="button" onClick={() => void reject(selected)}>拒绝</button></>}
              {selected.status !== "archived" && selected.status !== "rejected" && <button className="icon-btn danger" type="button" onClick={() => setForgetting(selected)} aria-label="遗忘" title="遗忘"><Trash2 size={16} /></button>}
              {selected.status === "archived" && <span className="memory-recover">可在 Markdown archive 中恢复</span>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(forgetting)} onOpenChange={(open) => { if (!open) setForgetting(null); }} title="遗忘这条记忆？" description={forgetting ? `“${forgetting.description}”会移出 active，并保留在 archive/ 中。` : undefined} onConfirm={() => void archive()} />
    </div>
  );
}
