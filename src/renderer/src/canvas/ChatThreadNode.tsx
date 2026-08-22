import { memo, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizeControl, Position, type ResizeParams } from "@xyflow/react";
import { Check, ChevronDown, MessageSquareText, Pencil, Trash2 } from "lucide-react";
import type { ApprovalRequestPayload, ModelSelection, NodeMsg, SkillEffectiveDto, ThinkingLevel, TurnCanvasEventPayload } from "../env";
import type { FileMentionRef } from "../../../common/fileMentions";
import type { SelectionContextNote } from "../../../common/selectionContext";
import { normalizeSelectionContextNotes } from "../../../common/selectionContext";
import { Composer, type ComposerImage } from "../composer/Composer";
import { SelectionNoteCapture, addSelectionContextNote } from "../composer/SelectionContextNotes";
import { IconArrowUpRight, IconChevronRight, IconSplit } from "../icons";
import { Message } from "../message/Message";
import type { MessageBranchMode } from "../ui/dialogs";
import { BranchContext } from "./branch";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { groupToolTimelineMessages, isToolCanvasEventPayload, upsertToolTimelineMessage, type ToolCallView } from "./toolTimeline";
import { useComposerHeightVar } from "./useComposerHeightVar";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { type NodeUpdate } from "./nodeUpdates";
import { selectNodeApproval, selectNodeLiveTurn, useWorkspaceStore } from "../workspace/store";
import { selectNodeTodoPlan } from "../workspace/store";
import { TodoProgressPanel } from "../composer/TodoProgressPanel";
import { ComposerTelemetryLine } from "../composer/ComposerTelemetryLine";
import { useNodeMetrics } from "../composer/useNodeMetrics";
import { useI18n } from "../i18n/I18nProvider";

type Role = "user" | "assistant" | "error" | "tool" | "skill" | "checkpoint";
type Msg = { id: number; role: Role; text: string; thinking?: string; images?: ComposerImage[]; fileMentions?: FileMentionRef[]; seq?: number; usage?: NodeMsg["usage"]; meta?: unknown; checkpoint?: NodeMsg["checkpoint"]; toolCall?: ToolCallView; skillEvent?: NodeMsg["skillEvent"] };
type SelectionToolbar = { text: string; x: number; y: number; place: "top" | "bottom"; arrowX: number };
type RectLike = Pick<DOMRect, "left" | "top" | "bottom" | "width" | "height">;

function formatModelSelection(model?: ModelSelection) {
  if (!model) return undefined;
  return typeof model === "string" ? model : `${model.providerId}/${model.modelId}`;
}

function parseModelSelection(value: string): ModelSelection {
  const [providerId, ...rest] = value.trim().split("/");
  const modelId = rest.join("/");
  return providerId && modelId ? { providerId, modelId } : value.trim();
}

export function selectionToolbarFromRects({
  text,
  selection,
  container,
  scrollLeft,
  scrollTop,
  clientWidth,
  zoom,
}: {
  text: string;
  selection: RectLike;
  container: RectLike;
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  zoom: number;
}): SelectionToolbar | null {
  if (selection.width === 0 && selection.height === 0) return null;
  const scale = zoom > 0 ? zoom : 1;
  const toolbarWidth = Math.min(240, Math.max(0, clientWidth - 24));
  const toolbarHalf = toolbarWidth / 2;
  const gutter = 12;
  const selectionCenterX = (selection.left - container.left + selection.width / 2) / scale;
  const rawX = scrollLeft + selectionCenterX;
  const minX = scrollLeft + gutter + toolbarHalf;
  const maxX = scrollLeft + clientWidth - gutter - toolbarHalf;
  const x = maxX >= minX ? Math.min(Math.max(rawX, minX), maxX) : rawX;
  const arrowX = Math.min(Math.max(rawX - x + toolbarHalf, 14), Math.max(14, toolbarWidth - 14));
  const selectionGap = 16;
  const preferredTop = scrollTop + (selection.top - container.top) / scale - selectionGap;
  const toolbarHeight = 104;
  const place = preferredTop - toolbarHeight < scrollTop + gutter ? "bottom" : "top";

  return {
    text,
    x,
    y: place === "top"
      ? preferredTop
      : scrollTop + (selection.bottom - container.top) / scale + selectionGap,
    place,
    arrowX,
  };
}

// macOS Finder 式颜色标签（存语义名，渲染走 --label-* token，明暗自适配）。
const NODE_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;

// 画布节点 = 一个活的 pi 对话线程（「索引卡片」）。发消息走 window.api.canvas，
// 订阅本 nodeId 的流式事件；头部显示 token 预算（含/不含祖先）与挂载开关。
export const ChatThreadNode = memo(function ChatThreadNode(props: any) {
  const { t } = useI18n();
  const { id, data } = props;
  const branch = useContext(BranchContext);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyScrollTopRef = useRef(0);
  const resizeScrollStateRef = useRef<{ active: boolean; top: number; atLatest: boolean }>({ active: false, top: 0, atLatest: true });
  const footRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const toMsgs = useCallback((items: NodeMsg[] = []) => (
    items.map((m) => ({ id: idRef.current++, role: m.role as Role, text: m.text, thinking: m.thinking, images: m.images, fileMentions: m.fileMentions, seq: m.seq, usage: m.usage, meta: m.meta, checkpoint: m.checkpoint, toolCall: m.toolCall, skillEvent: m.skillEvent }))
  ), []);

  const [msgs, setMsgs] = useState<Msg[]>(() => toMsgs(data.messages ?? []));
  const [busy, setBusy] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const liveTurn = useWorkspaceStore((state) => selectNodeLiveTurn(state, id));
  const todoPlan = useWorkspaceStore((state) => selectNodeTodoPlan(state, id));
  const hydrateTodoPlan = useWorkspaceStore((state) => state.hydrateTodoPlan);
  const [thinking, setThinking] = useState(false);
  const [turn, setTurn] = useState<TurnCanvasEventPayload | null>(null);
  const pendingApproval = useWorkspaceStore((state) => selectNodeApproval(state, id));
  const approval = pendingApproval ? { ...pendingApproval, scope: pendingApproval.defaultScope } : null;
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${id}`) ?? "");
  const [selectionNotes, setSelectionNotes] = useState<SelectionContextNote[]>(() => {
    try {
      return normalizeSelectionContextNotes(JSON.parse(localStorage.getItem(`loom:selection-notes:${id}`) ?? "[]"));
    } catch {
      return [];
    }
  });
  const selectionNotesNodeRef = useRef(id);
  const skipSelectionNotesSaveRef = useRef(false);
  const { metrics, refresh: refreshMetrics } = useNodeMetrics(id);
  const [tb, setTb] = useState<SelectionToolbar | null>(null);
  const [selectionNoteCaptureOpen, setSelectionNoteCaptureOpen] = useState(false);
  useEffect(() => {
    if (!tb) return;
    const isInsideToolbar = (target: EventTarget | null) => target instanceof Node && Boolean(toolbarRef.current?.contains(target));
    const isInsideSelectionNotePopup = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("[data-selection-note-popup]"));
    const onPointerDown = (event: PointerEvent) => {
      if (!isInsideToolbar(event.target) && !isInsideSelectionNotePopup(event.target)) setTb(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isInsideToolbar(event.target) && !isInsideSelectionNotePopup(event.target)) setTb(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [tb]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [title, setTitle] = useState(String(data.title ?? ""));
  const [editingTitle, setEditingTitle] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(String(data.systemPrompt ?? ""));
  const [nodeModel, setNodeModel] = useState<string | undefined>(formatModelSelection(data.model));
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel | undefined>(data.thinkingLevel);
  const [draftSkills, setDraftSkills] = useState<SkillEffectiveDto[]>([]);
  const [skillCount, setSkillCount] = useState<number>(Array.isArray(data.skills) ? data.skills.length : 0);
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const resizeTokenRef = useRef<number | null>(null);
  const color = typeof data.color === "string" ? data.color : "";

  useEffect(() => {
    resizeTokenRef.current = null;
  }, [data.resizeControlEpoch]);

  useEffect(() => {
    setMsgs(toMsgs(data.messages ?? []));
  }, [data.messages, toMsgs]);

  useEffect(() => {
    setTitle(String(data.title ?? ""));
    setPersona(String(data.systemPrompt ?? ""));
    setNodeModel(formatModelSelection(data.model));
    setThinkingLevelState(data.thinkingLevel);
    setSkillCount(Array.isArray(data.skills) ? data.skills.length : 0);
  }, [data.title, data.systemPrompt, data.model, data.thinkingLevel, data.skills]);

  useEffect(() => {
    if (!liveTurn) return;
    setThinking(false);
    setMsgs((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant") {
        return last.text === liveTurn.assistantText && last.thinking === liveTurn.assistantThinking
          ? current
          : [...current.slice(0, -1), { ...last, text: liveTurn.assistantText, thinking: liveTurn.assistantThinking }];
      }
      return [...current, { id: idRef.current++, role: "assistant", text: liveTurn.assistantText, thinking: liveTurn.assistantThinking }];
    });
  }, [liveTurn]);

  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!colorRef.current?.contains(e.target as Node)) setColorOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [colorOpen]);

  useEffect(() => {
    const request = window.api?.canvas?.plan?.(id);
    if (request) void request.then((snapshot) => hydrateTodoPlan(id, snapshot));
  }, [hydrateTodoPlan, id]);

  const reloadNode = useCallback(async () => {
    if (!window.api || !data.sessionId) return;
    const list = await window.api.canvas.list(data.sessionId);
    const next = list.find((n) => n.id === id);
    if (next) {
      setMsgs(toMsgs(next.messages));
      setTitle(next.title);
      setPersona(next.systemPrompt ?? "");
      setNodeModel(formatModelSelection(next.model));
      setThinkingLevelState(next.thinkingLevel);
      setSkillCount(next.skills?.length ?? 0);
      data.onNodeUpdated?.({
        id: next.id,
        sessionId: next.sessionId,
        title: next.title,
        color: next.color,
      } satisfies NodeUpdate);
    }
  }, [data, id, toMsgs]);

  const upsertToolMessage = useCallback((payload: Parameters<typeof upsertToolTimelineMessage<Msg>>[1]) => {
    setMsgs((current) => upsertToolTimelineMessage(current, payload, (toolCall) => ({
      id: idRef.current++,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    })));
  }, []);

  useEffect(() => {
    setInput(localStorage.getItem(`loom:draft:${id}`) ?? "");
    if (selectionNotesNodeRef.current !== id) {
      selectionNotesNodeRef.current = id;
      skipSelectionNotesSaveRef.current = true;
      try {
        setSelectionNotes(normalizeSelectionContextNotes(JSON.parse(localStorage.getItem(`loom:selection-notes:${id}`) ?? "[]")));
      } catch {
        setSelectionNotes([]);
      }
    }
    setBusy(false);
    setStopPending(false);
    setThinking(false);
    setTurn(null);
  }, [id]);

  useEffect(() => {
    localStorage.setItem(`loom:draft:${id}`, input);
  }, [id, input]);

  useEffect(() => {
    if (skipSelectionNotesSaveRef.current) {
      skipSelectionNotesSaveRef.current = false;
      return;
    }
    localStorage.setItem(`loom:selection-notes:${id}`, JSON.stringify(selectionNotes));
  }, [id, selectionNotes]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking, autoScroll]);

  // 悬浮输入框：把 foot 的实时高度回填给卡片，正文据此留出底部空间，
  // 让消息可以滚到输入框下方并在渐隐里淡出（而非被一块实心 foot 顶开）。
  useComposerHeightVar(footRef, cardRef);

  // 订阅本节点的流式事件
  useEffect(() => {
    if (!window.api) return;
    return window.api.canvas.onEvent((e) => {
      if (e.nodeId !== id) return;
      switch (e.type) {
        case "tool":
          {
            const payload = e.payload;
            if (isToolCanvasEventPayload(payload)) upsertToolMessage(payload);
          }
          break;
        case "approval":
          {
            const payload = e.payload as ApprovalRequestPayload;
            if (payload?.requestId && payload.nodeId === id) {
              const revision = payload.revision ?? useWorkspaceStore.getState().latestApprovalRevision + 1;
              useWorkspaceStore.getState().applyApproval({ type: "upsert", request: { ...payload, revision } });
            }
          }
          break;
        case "turn":
          {
            const payload = e.payload as TurnCanvasEventPayload;
            if (!payload?.turnId) break;
            setTurn(payload);
            if (payload.state === "running") {
              setBusy(true);
            } else if (payload.state === "awaiting_approval") {
              setBusy(true);
              setThinking(false);
            } else if (payload.state === "completed" || payload.state === "aborted" || payload.state === "failed") {
              setThinking(false);
              setBusy(false);
              void refreshMetrics();
              reloadNode();
            }
          }
          break;
        case "thinking":
          setThinking(true);
          setBusy(true);
          break;
        case "node_updated":
          reloadNode();
          data.onTreeChange?.();
          break;
        case "assistant_start":
        case "delta":
          // The workspace snapshot owns the active assistant tail.
          break;
        case "done":
          setThinking(false);
          setBusy(false);
          void refreshMetrics();
          reloadNode();
          data.onTreeChange?.();
          break;
        case "error":
          setThinking(false);
          setBusy(false);
          setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: String(e.payload ?? t("chat.genericError")) }]);
          break;
        case "permission":
          if (e.payload && typeof e.payload === "object" && (e.payload as { state?: string }).state === "denied") {
            const reason = (e.payload as { reason?: string }).reason ?? t("chat.genericError");
            setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: `Permission denied: ${reason}` }]);
          }
          break;
      }
    });
  }, [id, refreshMetrics, reloadNode, upsertToolMessage]);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !bodyRef.current || !sel || sel.rangeCount === 0) {
      setTb(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!bodyRef.current.contains(range.commonAncestorContainer)) {
      setTb(null);
      return;
    }
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setTb(null);
      return;
    }
    const box = bodyRef.current.getBoundingClientRect();
    const el = bodyRef.current;
    const zoom = box.width > 0 && el.clientWidth > 0 ? box.width / el.clientWidth : 1;
    const toolbar = selectionToolbarFromRects({
      text,
      selection: r,
      container: box,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      clientWidth: el.clientWidth,
      zoom,
    });
    setTb(toolbar);
  }, []);

  const doBranch = () => {
    if (tb) branch?.onBranch(id, tb.text, true, tb.text);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  const addSelectedText = (annotation: string) => {
    if (!tb) return;
    setSelectionNotes((current) => addSelectionContextNote(current, tb.text, annotation));
    setSelectionNoteCaptureOpen(false);
    setTb(null);
    window.getSelection()?.removeAllRanges();
  };

  async function submit(text: string, images: ComposerImage[] = [], skillIds: string[] = [], mentions: FileMentionRef[] = [], submittedSelectionNotes: SelectionContextNote[] = []) {
    if (isBusy || (!text && images.length === 0 && mentions.length === 0 && submittedSelectionNotes.length === 0)) return { ok: false };
    const optimisticId = idRef.current++;
    setMsgs((m) => [...m, { id: optimisticId, role: "user", text, images, fileMentions: mentions }]);
    setInput("");
    setDraftSkills([]);
    localStorage.removeItem(`loom:draft:${id}`);
    if (!window.api) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: t("node.browserPreview") }]);
      return { ok: false };
    }
    setBusy(true);
    setThinking(true);
    const result = mentions.length || submittedSelectionNotes.length
      ? await window.api.canvas.send(id, text, images, skillIds, mentions, submittedSelectionNotes)
      : await window.api.canvas.send(id, text, images, skillIds);
    if (!result.ok && result.reason === "file-mention-error") {
      const details = result.errors?.map((error) => `@${error.path}: ${error.message}`).join("; ") || "Unable to read file";
      setBusy(false);
      setThinking(false);
      setInput(text);
      setMsgs((m) => [
        ...m.filter((message) => message.id !== optimisticId),
        { id: idRef.current++, role: "error", text: t("node.fileReferenceFailed", { details }) },
      ]);
    }
    return result;
  }

  async function stop() {
    if (!window.api || stopPending) return;
    setStopPending(true);
    try {
      await window.api.canvas.abort(id);
    } finally {
      setStopPending(false);
    }
  }

  async function regenerate() {
    if (!window.api || isBusy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const lastUser = [...m].map((x) => x.role).lastIndexOf("user");
      return lastUser >= 0 ? m.slice(0, lastUser + 1) : m;
    });
    await window.api.canvas.regenerate(id);
    await reloadNode();
  }

  async function editResend(seq: number | undefined, text: string) {
    if (!window.api || seq == null || isBusy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const idx = m.findIndex((x) => x.seq === seq);
      return idx >= 0 ? [...m.slice(0, idx), { id: idRef.current++, role: "user", text, seq }] : m;
    });
    await window.api.canvas.editResend({ nodeId: id, seq, text });
    await reloadNode();
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next) return;
    setEditingTitle(false);
    await data.onRename?.(id, next);
  }

  async function savePersona() {
    await window.api?.canvas.setSystemPrompt(id, persona);
    setPersonaOpen(false);
    data.onTreeChange?.();
  }

  async function clearNode() {
    setMsgs([]);
    if (window.api) await window.api.canvas.reset(id);
    void refreshMetrics();
  }

  async function setModel(model: string) {
    const next = model.trim();
    if (!next || !window.api) return;
    const r = await window.api.canvas.setModel(id, parseModelSelection(next));
    if (r.ok) {
      setNodeModel(next);
      data.onTreeChange?.();
    }
  }

  async function setThinkingLevel(level: ThinkingLevel) {
    const r = await window.api.canvas.setThinkingLevel(id, level);
    if (r.ok) {
      setThinkingLevelState(level);
      data.onTreeChange?.();
    }
  }

  async function compactNode() {
    if (!window.api || isBusy) return;
    setBusy(true);
    setThinking(true);
    try {
      const result = await window.api.canvas.compact(id);
      if (result.ok) {
        await reloadNode();
      } else if (result.reason !== "not_needed") {
        setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: t("chat.compactionFailed", { error: result.error ?? result.reason ?? "unknown" }) }]);
      } else {
        setMsgs((m) => [...m, { id: idRef.current++, role: "tool", text: t("chat.compactionSkipped") }]);
      }
    } finally {
      setBusy(false);
      setThinking(false);
    }
  }

  async function enableSkill(skillId: string) {
    if (!window.api) return;
    const result = await window.api.canvas.skills(id);
    const skill = result.catalog.activeSkills.find((item) => item.id === skillId);
    if (!skill) return;
    setDraftSkills((current) => current.some((item) => item.id === skill.id)
      ? current
      : [...current, {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          sourceScope: skill.scope,
          sourcePath: skill.rootPath,
          hash: skill.hash,
          diagnostics: skill.diagnostics,
        }]);
  }

  function disableDraftSkill(skillId: string) {
    setDraftSkills((current) => current.filter((skill) => skill.id !== skillId));
  }

  function metaFor(m: Msg): string | undefined {
    const parts: string[] = [];
    const total = m.usage?.totalTokens;
    if (typeof total === "number") parts.push(`${total} tokens`);
    const meta = m.meta && typeof m.meta === "object" ? (m.meta as Record<string, unknown>) : {};
    const ms = meta.durationMs ?? meta.elapsedMs ?? meta.latencyMs;
    if (typeof ms === "number") parts.push(`${(ms / 1000).toFixed(1)}s`);
    return parts.length ? parts.join(" · ") : undefined;
  }

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    bodyScrollTopRef.current = el.scrollTop;
    setTb(null);
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }

  const seedText = String(data.seed?.text ?? "");
  const seedPreview = seedText.length > 42 ? `${seedText.slice(0, 42)}…` : seedText;
  const frozenContextMessageCount = Number(data.frozenContextMessageCount ?? 0);
  const frozenContextTokens = Number(data.frozenContextTokenEstimate ?? 0);
  const frozenContextTokenLabel = frozenContextTokens >= 1000
    ? `${(frozenContextTokens / 1000).toFixed(1)}k`
    : `${frozenContextTokens}`;
  const titleEditUnits = Array.from(title || "标题").reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  const titleEditWidth = `${Math.min(Math.max(titleEditUnits + 2, 8), 36)}ch`;
  const isBusy = busy || Boolean(liveTurn);
  const streaming = isBusy && msgs[msgs.length - 1]?.role === "assistant";
  const awaitingApproval = turn?.state === "awaiting_approval" && approval;
  const hasChildren = Boolean(data.hasChildren);
  const treeCollapsed = Boolean(data.isTreeCollapsed);
  const collapsedCount = Number(data.collapsedCount ?? 0);
  const isResizing = Boolean(data.isResizing);

  useEffect(() => {
    if (isResizing && !resizeScrollStateRef.current.active) {
      resizeScrollStateRef.current = {
        active: true,
        top: bodyScrollTopRef.current,
        atLatest: autoScroll,
      };
      return;
    }
    if (!isResizing && resizeScrollStateRef.current.active) {
      const saved = resizeScrollStateRef.current;
      resizeScrollStateRef.current.active = false;
      requestAnimationFrame(() => {
        const el = bodyRef.current;
        if (!el) return;
        el.scrollTop = saved.atLatest ? el.scrollHeight : saved.top;
        bodyScrollTopRef.current = el.scrollTop;
      });
    }
  }, [autoScroll, isResizing]);

  return (
    <div className={`card ${data.fresh ? "card--fresh" : ""}`} ref={cardRef}>
      {Boolean(props.selected) && (
        <NodeResizeControl
          key={data.resizeControlEpoch}
          nodeId={id}
          position="bottom-right"
          minWidth={288}
          minHeight={220}
          style={{
            left: "auto",
            top: "auto",
            right: 0,
            bottom: 0,
            width: 22,
            height: 22,
            transform: "none",
            transformOrigin: "bottom right",
          }}
          className="node-resize-control nodrag nopan"
          onResizeStart={(_, params: ResizeParams) => {
            const body = bodyRef.current;
            if (body) bodyScrollTopRef.current = body.scrollTop;
            resizeScrollStateRef.current = {
              active: true,
              top: bodyScrollTopRef.current,
              atLatest: autoScroll,
            };
            resizeTokenRef.current = data.onResizeStart?.(id, params) ?? null;
          }}
          shouldResize={(_, params: ResizeParams) => {
            const token = resizeTokenRef.current;
            return token != null && Boolean(data.shouldResize?.(id, token, params));
          }}
          onResize={(_, params: ResizeParams) => {
            if (resizeTokenRef.current != null) {
              data.onResize?.(id, resizeTokenRef.current, params);
            }
          }}
          onResizeEnd={(_, params: ResizeParams) => {
            if (resizeTokenRef.current != null) {
              data.onResizeEnd?.(id, resizeTokenRef.current, params);
            }
            resizeTokenRef.current = null;
          }}
        >
          <span className="node-resize-corner" aria-hidden="true" />
        </NodeResizeControl>
      )}
      <div className="card__head">
        <div className="node-color nodrag" ref={colorRef}>
          <button
            className={`color-dot ${color ? "is-set" : ""}`}
            style={color ? { background: `var(--label-${color})` } : undefined}
            title={t("node.colorLabel")}
            onClick={() => setColorOpen((v) => !v)}
          />
          {colorOpen && (
            <div className="color-pop">
              <button
                className="color-swatch is-none"
                title={t("nav.noColor")}
                onClick={() => {
                  data.onSetColor?.(id, "");
                  setColorOpen(false);
                }}
              >
                {!color && <Check size={11} />}
              </button>
              {NODE_COLORS.map((c) => (
                <button
                  key={c}
                  className="color-swatch"
                  style={{ background: `var(--label-${c})` }}
                  title={c}
                  onClick={() => {
                    data.onSetColor?.(id, c);
                    setColorOpen(false);
                  }}
                >
                  {color === c && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="head-main">
          {editingTitle ? (
            <input
              className="title-edit nodrag"
              style={{ width: titleEditWidth }}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitle(String(data.title ?? ""));
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <div className="title-row">
              <span className="title title-text" title={title}>
                {title}
              </span>
              <button
                className="title-edit-btn nodrag"
                type="button"
                title={t("node.editTitle")}
                aria-label={t("node.editTitle")}
                onClick={() => setEditingTitle(true)}
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <div className="head-meta">
            {nodeModel && <span className="model" title={nodeModel}>{nodeModel}</span>}
            {skillCount > 0 && <span className="tokens" title={t("node.activeSkills")}>skills {skillCount}</span>}
          </div>
        </div>
        <button
          className="head-icon nodrag"
          type="button"
          title={t("node.backToChat")}
          aria-label={t("node.backToChat")}
          onClick={() => data.onReturnChat?.(id)}
        >
          <MessageSquareText size={13} />
        </button>
        {!data.isRoot && (
          <button className="head-icon danger nodrag" title={t("node.deleteSession")} onClick={() => data.onDelete?.(id)}>
            <Trash2 size={13} />
          </button>
        )}
        {hasChildren && (
          <button
            className={`tree-toggle nodrag ${treeCollapsed ? "is-collapsed" : ""}`}
            onClick={() => data.onToggleCollapse?.(id)}
            title={treeCollapsed ? t("node.expandTree", { count: collapsedCount }) : t("node.collapseTree")}
          >
            <IconChevronRight size={14} />
            {treeCollapsed && collapsedCount > 0 && <span className="tree-count">{collapsedCount}</span>}
          </button>
        )}
      </div>

      {personaOpen && (
        <div className="persona nodrag">
          <textarea
            value={persona}
            placeholder={t("chat.defaultPersona")}
            onChange={(e) => setPersona(e.target.value)}
          />
          <button onClick={savePersona}>
            <Check size={13} /> {t("chat.save")}
          </button>
        </div>
      )}

      <div
        className="card__body nodrag nowheel"
        ref={bodyRef}
        onMouseUp={onMouseUp}
        onScroll={onBodyScroll}
        onBlur={() => setTb(null)}
      >
        {isResizing ? (
          <div className="card__resize-preview" aria-label={t("node.resizePreview")}>
            <span className="card__resize-preview-label">{t("node.resizeWindow")}</span>
            <strong>{msgs.length ? t("node.messageCount", { count: msgs.length }) : t("node.noMessages")}</strong>
          </div>
        ) : (
          <>
          {data.seed && (
            <button
              className="seed seed--chip nodrag"
              type="button"
              onClick={() => branch?.onFocusNode?.(data.seed.parent, { flash: true })}
              title={t("node.jumpToSource")}
            >
              <span className="seed__from">{t("node.from", { from: data.seed.from })}</span>
              <span className="seed__q">“{seedPreview}”</span>
              {frozenContextMessageCount > 0 && (
                <span className="seed__context">
                  {t("node.frozenContext", { count: frozenContextMessageCount, tokens: frozenContextTokenLabel })}
                </span>
              )}
              <IconArrowUpRight size={13} />
            </button>
          )}

          {msgs.length === 0 && !thinking && (
            <div className="empty">{data.seed ? t("node.seedPrompt") : t("node.startThinking")}</div>
          )}

          {groupToolTimelineMessages(msgs).map((item) => (
            item.kind === "tools" ? (
              <ToolCallTimeline key={item.key} calls={item.calls} density="compact" />
            ) : (
              <Message
                key={item.message.id}
                role={item.message.role}
                text={item.message.text}
                thinking={item.message.thinking}
                images={item.message.images}
                fileMentions={item.message.fileMentions}
                density="compact"
                streaming={item.message.role === "assistant" && streaming && item.message.id === msgs[msgs.length - 1]?.id}
                meta={item.message.role === "assistant" ? metaFor(item.message) : undefined}
                checkpoint={item.message.checkpoint}
                canRegenerate={item.message.role === "assistant" && item.message.id === msgs[msgs.length - 1]?.id && !isBusy}
                canEdit={item.message.role === "user" && !isBusy}
                sourceSeq={item.message.seq}
                messageSeq={item.message.seq}
                onBranch={(mode: MessageBranchMode, sourceSeq) => data.onMessageBranch?.(id, sourceSeq, mode)}
                onRegenerate={regenerate}
                onEditResend={(text) => editResend(item.message.seq, text)}
                onRetry={item.message.role === "error" ? regenerate : undefined}
              />
            )
          ))}

          {thinking && !liveTurn && <div className="thinking"><span className="dot">·</span> {t("chat.thinking")}</div>}

          {tb && (
            <div
              className={`seltb seltb--${tb.place} ${selectionNoteCaptureOpen ? "seltb--selection-note-open" : ""}`}
              ref={toolbarRef}
              aria-hidden={selectionNoteCaptureOpen}
              style={{ left: tb.x, top: tb.y, "--seltb-arrow-x": `${tb.arrowX}px` } as CSSProperties}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseUp={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="selection-toolbar-actions">
                <button className="selection-toolbar-action" onClick={doBranch}>
                  <span><IconSplit size={13} /> {t("node.expandHere")}</span>
                </button>
                <SelectionNoteCapture selectedText={tb.text} onConfirm={addSelectedText} onOpenChange={setSelectionNoteCaptureOpen} />
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {!autoScroll && (
        <button
          className="to-latest to-latest--card nodrag"
          type="button"
          aria-label={t("node.backToLatest")}
          title={t("node.backToLatest")}
          onClick={() => {
            setAutoScroll(true);
            requestAnimationFrame(() => {
              const el = bodyRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }}
        >
          <ChevronDown size={18} />
        </button>
      )}

      <div className="card__foot nodrag" ref={footRef}>
        <Composer
          nodeId={id}
          value={input}
          onChange={setInput}
          busy={isBusy}
          stopPending={stopPending}
          placeholder={awaitingApproval ? t("chat.approvalPlaceholder") : isBusy ? t("chat.generatingPlaceholder") : msgs.length ? t("chat.continuePlaceholder") : data.seed ? t("chat.seedPlaceholder") : t("chat.startPlaceholder")}
          topAccessory={(
            <>
              <TodoProgressPanel plan={todoPlan} />
              {awaitingApproval ? (
                <ApprovalPrompt
                  approval={approval}
                  compact
                  onScopeChange={() => undefined}
                  onDecision={(action, scope) => {
                    if (!window.api) return;
                    useWorkspaceStore.getState().applyApproval({ type: "remove", requestId: approval.requestId, revision: useWorkspaceStore.getState().latestApprovalRevision + 1 });
                    void window.api.canvas.decideApproval({
                      requestId: approval.requestId,
                      nodeId: approval.nodeId,
                      turnId: approval.turnId,
                      toolCallId: approval.toolCallId,
                      toolName: approval.toolName,
                      capability: approval.capability,
                      normalizedTarget: approval.normalizedTarget,
                      action,
                      scope: action === "allow" ? scope ?? approval.scope : undefined,
                    }).then((result) => {
                      if (!result.ok) useWorkspaceStore.getState().applyApproval({ type: "upsert", request: { ...approval, revision: useWorkspaceStore.getState().latestApprovalRevision + 1 } });
                    });
                  }}
                />
              ) : null}
            </>
          )}
          activeSkills={draftSkills}
          canRegenerate={msgs.some((m) => m.role === "user") && !isBusy}
          model={nodeModel}
          thinkingLevel={thinkingLevel}
          onSubmit={submit}
          selectionNotes={selectionNotes}
          onSelectionNotesChange={setSelectionNotes}
          onStop={stop}
          onOpenPersona={() => setPersonaOpen(true)}
          onClearNode={clearNode}
          onRegenerate={regenerate}
          onSetModel={setModel}
          onSetThinkingLevel={setThinkingLevel}
          onCompact={compactNode}
          budgetRefreshKey={msgs.length}
          onEnableSkill={enableSkill}
          onDisableSkill={disableDraftSkill}
          telemetryLine={<ComposerTelemetryLine metrics={metrics} />}
        />
      </div>

      <Handle type="target" position={Position.Left} className="h" />
      <Handle type="source" position={Position.Right} className="h" />
    </div>
  );
}, (previous, next) => (
  previous.id === next.id &&
  previous.selected === next.selected &&
  previous.data === next.data &&
  previous.className === next.className &&
  previous.width === next.width &&
  previous.height === next.height
));
