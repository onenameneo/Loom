import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Brain, Check, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { ProjectMeta } from "../env";
import { ConfirmDialog } from "../ui/dialogs";

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
  const [dreamPhase, setDreamPhase] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<MemoryRecord | null>(null);
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

  useEffect(() => {
    void reload();
    if (!window.api?.memory) return;
    return window.api.memory.onEvent((event) => {
      if (event.type === "autodream") {
        const progress = event.progress as { phase?: string } | undefined;
        setDreamPhase(progress?.phase ?? null);
        if (progress?.phase === "completed" || progress?.phase === "failed" || progress?.phase === "cancelled") setDreaming(false);
      }
      void reload();
    });
  }, [reload]);

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
    setDreaming(true);
    try {
      await window.api.memory.autodreamRun();
      await reload();
    } finally {
      setDreaming(false);
    }
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

  return (
    <div className="memory-page">
      <header className="memory-page__header">
        <div>
          <div className="eyebrow"><Brain size={13} /> CROSS-SESSION MEMORY</div>
          <h1>长期记忆</h1>
          <p>Markdown 是事实源。候选记忆先观察，再决定是否留下。</p>
        </div>
        <div className="memory-page__actions">
          <button className="icon-btn" type="button" onClick={() => void reload()} disabled={loading} title="刷新" aria-label="刷新记忆"><RefreshCw size={15} /></button>
          <button className="btn" type="button" onClick={() => void runAutoDream()} disabled={dreaming}><Sparkles size={14} /> {dreaming ? `整理中 · ${dreamPhase ?? "准备"}` : "运行 AutoDream"}</button>
        </div>
      </header>

      <div className="memory-stats" aria-label="记忆统计">
        <span><strong>{stats.active}</strong> active</span>
        <span className={stats.candidates ? "is-warn" : ""}><strong>{stats.candidates}</strong> candidates</span>
        <span><strong>{stats.archived}</strong> archived</span>
        {stats.issues > 0 && <span className="is-err"><strong>{stats.issues}</strong> 文件问题</span>}
      </div>

      <section className="memory-quick-add">
        <select value={quickType} onChange={(event) => setQuickType(event.target.value as MemoryRecord["type"])} aria-label="记忆类型">
          {(Object.keys(TYPE_LABEL) as MemoryRecord["type"][]).map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
        </select>
        <input value={quickContent} onChange={(event) => setQuickContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void quickRemember(); }} placeholder="明确记住一条可跨会话复用的内容…" />
        <button className="icon-btn primary" type="button" onClick={() => void quickRemember()} disabled={!quickContent.trim()} aria-label="记住" title="记住"><Check size={15} /></button>
      </section>

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

        <aside className="memory-detail">
          {selected ? (
            <>
              <div className="memory-detail__head"><div><span className="eyebrow">{TYPE_LABEL[selected.type]} · {selected.status}</span><h2>{selected.description}</h2></div><button className="icon-btn" type="button" onClick={() => setSelectedId(null)} aria-label="关闭详情"><X size={15} /></button></div>
              <p className="memory-detail__content">{selected.content}</p>
              <dl className="memory-meta"><div><dt>confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div><div><dt>source</dt><dd>{selected.source.trigger}</dd></div><div><dt>updated</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></div></dl>
              {selected.source.excerpt && <blockquote>{selected.source.excerpt}</blockquote>}
              <div className="memory-detail__actions">
                {selected.status === "candidate" && <><button className="btn primary" type="button" onClick={() => void approve(selected)}><Check size={14} /> 批准</button><button className="btn" type="button" onClick={() => void reject(selected)}>拒绝</button></>}
                {selected.status !== "archived" && selected.status !== "rejected" && <button className="icon-btn danger" type="button" onClick={() => setForgetting(selected)} aria-label="遗忘" title="遗忘"><Trash2 size={15} /></button>}
                {selected.status === "archived" && <span className="memory-recover">可在 Markdown archive 中恢复</span>}
              </div>
            </>
          ) : <div className="memory-detail__placeholder"><Archive size={18} /><span>选择一条记忆查看来源、置信度和正文。</span></div>}
        </aside>
      </div>
      <ConfirmDialog open={Boolean(forgetting)} onOpenChange={(open) => { if (!open) setForgetting(null); }} title="遗忘这条记忆？" description={forgetting ? `“${forgetting.description}”会移出 active，并保留在 archive/ 中。` : undefined} onConfirm={() => void archive()} />
    </div>
  );
}
