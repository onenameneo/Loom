import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ApprovalRequestPayload, BranchSource, LiveTurnContentPart, ModelSelection, NodeMsg, SkillEffectiveDto, ThinkingLevel, TurnCanvasEventPayload } from "../env";
import type { FileMentionRef } from "../../../common/fileMentions";
import type { FileArtifactRef } from "../../../common/fileArtifacts";
import type { SelectionContextNote } from "../../../common/selectionContext";
import { normalizeSelectionContextNotes } from "../../../common/selectionContext";
import { IconSplit, IconProject } from "../icons";
import { Message } from "../message/Message";
import type { MessageBranchMode } from "../ui/dialogs";
import { Composer, type ComposerImage } from "../composer/Composer";
import { SelectionNoteCapture, addSelectionContextNote } from "../composer/SelectionContextNotes";
import { useTitlebarActions } from "../titlebar/Titlebar";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { groupToolTimelineMessages, isToolCanvasEventPayload, upsertToolTimelineMessage, type ToolCallView } from "./toolTimeline";
import { appendLiveTurnMessage, hasLiveTurnOutput } from "./liveTurnMessages";
import { useComposerHeightVar } from "./useComposerHeightVar";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { selectNodeApproval, selectNodeLiveTurn, selectNodeTodoPlan, useWorkspaceStore } from "../workspace/store";
import { TodoProgressPanel } from "../composer/TodoProgressPanel";
import { ComposerTelemetryLine } from "../composer/ComposerTelemetryLine";
import { useNodeMetrics } from "../composer/useNodeMetrics";
import { useI18n } from "../i18n/I18nProvider";

type Role = "user" | "assistant" | "error" | "tool" | "skill" | "checkpoint";
type Msg = { id: number; role: Role; text: string; thinking?: string; contentParts?: LiveTurnContentPart[]; images?: ComposerImage[]; fileMentions?: FileMentionRef[]; selectionNotes?: SelectionContextNote[]; artifacts?: FileArtifactRef[]; seq?: number; usage?: NodeMsg["usage"]; meta?: unknown; checkpoint?: NodeMsg["checkpoint"]; toolCall?: ToolCallView; skillEvent?: NodeMsg["skillEvent"] };

function formatModelSelection(model?: ModelSelection) {
  if (!model) return undefined;
  return typeof model === "string" ? model : `${model.providerId}/${model.modelId}`;
}

function parseModelSelection(value: string): ModelSelection {
  const [providerId, ...rest] = value.trim().split("/");
  const modelId = rest.join("/");
  return providerId && modelId ? { providerId, modelId } : value.trim();
}

// 对话优先视图：单个起点摊开成经典居中聊天（「聊天 = 只有一个节点的画布」）。
// 走同一套 window.api.canvas；在回复里划词 → 从这里展开 → 上层切成画布视图。
export default function ChatView({
  nodeId,
  initialMessages,
  hasFrozenContext,
  systemPrompt,
  model,
  thinkingLevel: initialThinkingLevel,
  onBranch,
  onMessageBranch,
  branchSource,
  onReturnToBranch,
  focusMessageSeq,
  onExpandCanvas,
  onTreeChange,
  noKey,
  goSettings,
}: {
  nodeId: string;
  initialMessages: NodeMsg[];
  hasFrozenContext: boolean;
  systemPrompt?: string;
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  onBranch: (seedText: string, includeParentContext: boolean) => void;
  onMessageBranch?: (sourceSeq: number, mode: MessageBranchMode) => void | Promise<void>;
  branchSource?: BranchSource;
  onReturnToBranch?: () => void | Promise<void>;
  focusMessageSeq?: number;
  onExpandCanvas: () => void;
  onTreeChange?: () => void;
  noKey: boolean;
  goSettings: () => void;
}) {
  const { t } = useI18n();
  const idRef = useRef(1);
  const initialMessagesRef = useRef({ nodeId, messages: initialMessages });
  const goSettingsRef = useRef(goSettings);
  goSettingsRef.current = goSettings;
  const seed = (initialMessages ?? []).map((m) => ({
    id: idRef.current++,
    role: m.role as Role,
    text: m.text,
    thinking: m.thinking,
    images: m.images,
    fileMentions: m.fileMentions,
    selectionNotes: m.selectionNotes,
    artifacts: m.artifacts,
    seq: m.seq,
    usage: m.usage,
    meta: m.meta,
    checkpoint: m.checkpoint,
    toolCall: m.toolCall,
    skillEvent: m.skillEvent,
  }));
  const [msgs, setMsgs] = useState<Msg[]>(seed);
  const [draftSkills, setDraftSkills] = useState<SkillEffectiveDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [turn, setTurn] = useState<TurnCanvasEventPayload | null>(null);
  const [input, setInput] = useState(() => localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
  const todoPlan = useWorkspaceStore((state) => selectNodeTodoPlan(state, nodeId));
  const pendingApproval = useWorkspaceStore((state) => selectNodeApproval(state, nodeId));
  const approval = pendingApproval ? { ...pendingApproval, scope: pendingApproval.defaultScope } : null;
  const hydrateTodoPlan = useWorkspaceStore((state) => state.hydrateTodoPlan);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [persona, setPersona] = useState(systemPrompt ?? "");
  const [nodeModel, setNodeModel] = useState<string | undefined>(formatModelSelection(model));
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel | undefined>(initialThinkingLevel);
  const { metrics, refresh: refreshMetrics } = useNodeMetrics(nodeId);
  const [autoScroll, setAutoScroll] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const clearingRef = useRef(false);
  const [tb, setTb] = useState<{ text: string; x: number; y: number } | null>(null);
  const [selectionNoteCaptureOpen, setSelectionNoteCaptureOpen] = useState(false);
  const [selectionNotes, setSelectionNotes] = useState<SelectionContextNote[]>(() => {
    try {
      return normalizeSelectionContextNotes(JSON.parse(localStorage.getItem(`loom:selection-notes:${nodeId}`) ?? "[]"));
    } catch {
      return [];
    }
  });
  const selectionNotesNodeRef = useRef(nodeId);
  const skipSelectionNotesSaveRef = useRef(false);
  const liveTurn = useWorkspaceStore((state) => selectNodeLiveTurn(state, nodeId));

  useEffect(() => {
    let active = true;
    const request = window.api?.canvas?.plan?.(nodeId);
    if (request) void request.then((snapshot) => { if (active) hydrateTodoPlan(nodeId, snapshot); });
    return () => { active = false; };
  }, [hydrateTodoPlan, nodeId]);

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

  const openSettings = useCallback(() => {
    goSettingsRef.current();
  }, []);

  const titlebarActions = useMemo(
    () => (
      <>
        <button
          className="titlebar-button canvas-titlebar-action"
          type="button"
          onClick={onExpandCanvas}
          aria-label={t("chat.expandCanvas")}
          title={t("chat.expandCanvas")}
        >
          <IconProject size={15} />
        </button>
        {noKey && (
          <button className="chip-warn" type="button" onClick={openSettings}>
            {t("chat.noApiKey")}
          </button>
        )}
      </>
    ),
    [noKey, onExpandCanvas, openSettings, t],
  );
  useTitlebarActions(titlebarActions);

  const reloadFromInitial = useCallback((items: NodeMsg[], targetNodeId: string) => {
    const restored: Msg[] = items.map((m) => ({ id: idRef.current++, role: m.role as Role, text: m.text, thinking: m.thinking, images: m.images, fileMentions: m.fileMentions, selectionNotes: m.selectionNotes, artifacts: m.artifacts, seq: m.seq, usage: m.usage, meta: m.meta, checkpoint: m.checkpoint, toolCall: m.toolCall, skillEvent: m.skillEvent }));
    // A tree refresh can race an in-flight Node. Merge the authoritative live
    // snapshot into the refreshed transcript instead of briefly replacing it
    // with an older persisted copy.
    const live = useWorkspaceStore.getState().turnsByNodeId[targetNodeId];
    setMsgs(live
      ? appendLiveTurnMessage(restored, live, (text, thinking) => ({ id: idRef.current++, role: "assistant", text, thinking }))
      : restored);
  }, []);

  const upsertToolMessage = useCallback((payload: Parameters<typeof upsertToolTimelineMessage<Msg>>[1]) => {
    setMsgs((current) => upsertToolTimelineMessage(current, payload, (toolCall) => ({
      id: idRef.current++,
      role: "tool",
      text: toolCall.summary ?? "",
      toolCall,
    })));
  }, []);

  useEffect(() => {
    const previous = initialMessagesRef.current;
    if (previous.nodeId === nodeId && previous.messages === initialMessages) return;
    initialMessagesRef.current = { nodeId, messages: initialMessages };
    reloadFromInitial(initialMessages ?? [], nodeId);
  }, [initialMessages, nodeId, reloadFromInitial]);

  // The App-owned bridge is the only live-turn IPC consumer. A returning view
  // derives its assistant tail directly from that Node's snapshot.
  useEffect(() => {
    if (!liveTurn) return;
    setThinking(false);
    setMsgs((current) => appendLiveTurnMessage(current, liveTurn, (text, thinking) => ({ id: idRef.current++, role: "assistant", text, thinking })));
  }, [liveTurn]);

  useEffect(() => {
    setInput(localStorage.getItem(`loom:draft:${nodeId}`) ?? "");
    setBusy(false);
    setStopPending(false);
    setThinking(false);
    setTurn(null);
    if (selectionNotesNodeRef.current !== nodeId) {
      selectionNotesNodeRef.current = nodeId;
      skipSelectionNotesSaveRef.current = true;
      try {
        setSelectionNotes(normalizeSelectionContextNotes(JSON.parse(localStorage.getItem(`loom:selection-notes:${nodeId}`) ?? "[]")));
      } catch {
        setSelectionNotes([]);
      }
    }
    setPersona(systemPrompt ?? "");
    setNodeModel(formatModelSelection(model));
    setThinkingLevelState(initialThinkingLevel);
  }, [initialThinkingLevel, model, nodeId, systemPrompt]);

  useEffect(() => {
    if (typeof focusMessageSeq !== "number") return;
    const target = threadRef.current?.querySelector(`[data-message-seq="${focusMessageSeq}"]`);
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusMessageSeq, nodeId, msgs.length]);

  useEffect(() => {
    localStorage.setItem(`loom:draft:${nodeId}`, input);
  }, [nodeId, input]);

  useEffect(() => {
    if (skipSelectionNotesSaveRef.current) {
      skipSelectionNotesSaveRef.current = false;
      return;
    }
    localStorage.setItem(`loom:selection-notes:${nodeId}`, JSON.stringify(selectionNotes));
  }, [nodeId, selectionNotes]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.canvas.onEvent((e) => {
      if (e.nodeId !== nodeId) return;
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
            if (payload?.requestId && payload.nodeId === nodeId) {
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
              setBusy(false);
              setThinking(false);
              void refreshMetrics();
            }
          }
          break;
        case "thinking":
          setThinking(true);
          break;
        case "node_updated":
          onTreeChange?.();
          break;
        case "done":
          setThinking(false);
          setBusy(false);
          void refreshMetrics();
          onTreeChange?.();
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
  }, [nodeId, onTreeChange, refreshMetrics, upsertToolMessage]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking, autoScroll]);

  // 悬浮输入框：把 composer 的实时高度回填给视图，滚动区据此留出底部空间。
  useComposerHeightVar(composerRef, rootRef);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !threadRef.current || !sel || sel.rangeCount === 0) {
      setTb(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!threadRef.current.contains(range.commonAncestorContainer)) {
      setTb(null);
      return;
    }
    const r = range.getBoundingClientRect();
    const box = threadRef.current.getBoundingClientRect();
    setTb({ text, x: r.left - box.left + r.width / 2, y: r.top - box.top - 6 });
  }, []);

  const doBranch = () => {
    if (tb) onBranch(tb.text, true);
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

  const isBusy = busy || Boolean(liveTurn);
  const streaming = isBusy && msgs[msgs.length - 1]?.role === "assistant";
  const agentLoading = thinking || (Boolean(liveTurn) && !hasLiveTurnOutput(liveTurn));
  const awaitingApproval = turn?.state === "awaiting_approval" && approval;

  async function submit(text: string, images: ComposerImage[] = [], skillIds: string[] = [], mentions: FileMentionRef[] = [], submittedSelectionNotes: SelectionContextNote[] = []) {
    if (isBusy || (!text && images.length === 0 && mentions.length === 0 && submittedSelectionNotes.length === 0)) return { ok: false };
    const optimisticId = idRef.current++;
    setMsgs((m) => [...m, { id: optimisticId, role: "user", text, images, fileMentions: mentions, selectionNotes: submittedSelectionNotes }]);
    setInput("");
    setDraftSkills([]);
    localStorage.removeItem(`loom:draft:${nodeId}`);
    if (!window.api) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: t("chat.browserPreview") }]);
      return { ok: false };
    }
    setBusy(true);
    setThinking(true);
    const result = mentions.length || submittedSelectionNotes.length
      ? await window.api.canvas.send(nodeId, text, images, skillIds, mentions, submittedSelectionNotes)
      : await window.api.canvas.send(nodeId, text, images, skillIds);
    if (!result.ok && result.reason === "file-mention-error") {
      const details = result.errors?.map((error) => `@${error.path}: ${error.message}`).join("; ") || "Unable to read file";
      setBusy(false);
      setThinking(false);
      setInput(text);
      setMsgs((m) => [
        ...m.filter((message) => message.id !== optimisticId),
        { id: idRef.current++, role: "error", text: t("chat.fileReferenceFailed", { details }) },
      ]);
    }
    return result;
  }

  async function stop() {
    if (!window.api || stopPending) return;
    setStopPending(true);
    try {
      await window.api.canvas.abort(nodeId);
    } finally {
      setStopPending(false);
    }
  }

  const regenerate = useCallback(async () => {
    if (!window.api || isBusy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const lastUser = [...m].map((x) => x.role).lastIndexOf("user");
      return lastUser >= 0 ? m.slice(0, lastUser + 1) : m;
    });
    await window.api.canvas.regenerate(nodeId);
  }, [isBusy, nodeId]);

  const editResend = useCallback(async (seq: number | undefined, text: string) => {
    if (!window.api || seq == null || isBusy) return;
    setBusy(true);
    setThinking(true);
    setMsgs((m) => {
      const idx = m.findIndex((x) => x.seq === seq);
      return idx >= 0 ? [...m.slice(0, idx), { id: idRef.current++, role: "user", text, seq }] : m;
    });
    await window.api.canvas.editResend({ nodeId, seq, text });
  }, [isBusy, nodeId]);

  const handleMessageBranch = useCallback((mode: MessageBranchMode, sourceSeq: number) => {
    return onMessageBranch?.(sourceSeq, mode);
  }, [onMessageBranch]);

  async function clearNode() {
    if (clearingRef.current) return;
    clearingRef.current = true;
    try {
      if (!window.api) throw new Error(t("chat.browserPreview"));
      const result = await window.api.canvas.reset(nodeId);
      if (!result?.ok) throw new Error(t("chat.genericError"));
      setMsgs([]);
      setTurn(null);
      setThinking(false);
      setBusy(false);
      setStopPending(false);
      void refreshMetrics();
    } catch (error) {
      setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: error instanceof Error ? error.message : t("chat.genericError") }]);
    } finally {
      clearingRef.current = false;
    }
  }

  async function savePersona() {
    await window.api?.canvas.setSystemPrompt(nodeId, persona);
    setPersonaOpen(false);
  }

  async function setModel(modelId: string) {
    const next = modelId.trim();
    if (!next || !window.api) return;
    const r = await window.api.canvas.setModel(nodeId, parseModelSelection(next));
    if (r.ok) setNodeModel(next);
  }

  async function setThinkingLevel(level: ThinkingLevel) {
    const r = await window.api.canvas.setThinkingLevel(nodeId, level);
    if (r.ok) setThinkingLevelState(level);
  }

  async function compactNode() {
    if (!window.api || isBusy) return;
    setBusy(true);
    setThinking(true);
    try {
      const result = await window.api.canvas.compact(nodeId);
      if (result.ok) {
        if (result.node) reloadFromInitial(result.node.messages ?? [], nodeId);
        setMsgs((m) => [...m, { id: idRef.current++, role: "tool", text: t("chat.compactionDone") }]);
      } else if (result.reason === "not_needed") {
        setMsgs((m) => [...m, { id: idRef.current++, role: "tool", text: t("chat.compactionSkipped") }]);
      } else {
        setMsgs((m) => [...m, { id: idRef.current++, role: "error", text: t("chat.compactionFailed", { error: result.error ?? result.reason ?? "unknown" }) }]);
      }
      void refreshMetrics();
    } finally {
      setBusy(false);
      setThinking(false);
    }
  }

  async function enableSkill(skillId: string) {
    if (!window.api) return;
    const result = await window.api.canvas.skills(nodeId);
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

  function BranchReturnNotice() {
    if (!branchSource || !onReturnToBranch) return null;
    return (
      <button className="branch-return-notice" type="button" onClick={() => void onReturnToBranch()}>
        <IconSplit size={14} aria-hidden="true" />
        <span>{t("chat.continue")}</span>
      </button>
    );
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setTb(null);
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }

  const renderItems = useMemo(() => groupToolTimelineMessages(msgs), [msgs]);

  return (
    <div className="chatview" ref={rootRef}>
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="thread" ref={threadRef} onMouseUp={onMouseUp}>
          {(personaOpen || nodeModel) && (
            <div className="chatview-nodebar nodrag">
              {nodeModel && <span className="model">{nodeModel}</span>}
              {personaOpen && (
                <div className="persona persona--chatview">
                  <textarea
                    value={persona}
                    placeholder={t("chat.defaultPersona")}
                    onChange={(e) => setPersona(e.target.value)}
                  />
                  <button onClick={savePersona}>{t("chat.save")}</button>
                </div>
              )}
            </div>
          )}
          {msgs.length === 0 && !agentLoading && (
            <div className="cv-empty">
              {t("node.startThinking")}
              <br />
              <span className="mono">{t("chat.branchHint")}</span>
            </div>
          )}
          {renderItems.map((item) => (
            <Fragment key={item.kind === "tools" ? item.key : item.message.id}>
              {item.kind === "tools" ? (
                <ToolCallTimeline calls={item.calls} density="comfortable" />
              ) : (
                <Message
                  role={item.message.role}
                  text={item.message.text}
                  thinking={item.message.thinking}
                  contentParts={item.message.contentParts}
                  images={item.message.images}
                  fileMentions={item.message.fileMentions}
                  artifacts={item.message.artifacts}
                  selectionNotes={item.message.selectionNotes}
                  density="comfortable"
                  streaming={item.message.role === "assistant" && streaming && item.message.id === msgs[msgs.length - 1].id}
                  meta={item.message.role === "assistant" ? metaFor(item.message) : undefined}
                  checkpoint={item.message.checkpoint}
                  canRegenerate={item.message.role === "assistant" && item.message.id === msgs[msgs.length - 1]?.id && !isBusy}
                  canEdit={item.message.role === "user" && !isBusy}
                  sourceSeq={item.message.seq}
                  messageSeq={item.message.seq}
                  onBranch={onMessageBranch ? handleMessageBranch : undefined}
                  onRegenerate={regenerate}
                  onEditResendWithSeq={editResend}
                  onRetry={item.message.role === "error" ? regenerate : undefined}
                />
              )}
              {item.kind === "message" && item.message.seq === branchSource?.messageSeq && <BranchReturnNotice />}
            </Fragment>
          ))}
          {agentLoading && (
            <div className="thinking" role="status" aria-live="polite">
              <span className="dot">·</span> {t("chat.thinking")}
            </div>
          )}
          {tb && (
            <div
              className={`seltb ${selectionNoteCaptureOpen ? "seltb--selection-note-open" : ""}`}
              ref={toolbarRef}
              aria-hidden={selectionNoteCaptureOpen}
              style={{ left: tb.x, top: tb.y }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseUp={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="selection-toolbar-actions">
                <button className="selection-toolbar-action" onClick={doBranch}>
                  <span><IconSplit size={13} /> {t("chat.expandFromHere")}</span>
                </button>
                <SelectionNoteCapture selectedText={tb.text} onConfirm={addSelectedText} onOpenChange={setSelectionNoteCaptureOpen} />
              </div>
            </div>
          )}
        </div>
      </div>
      {!autoScroll && (
        <button className="to-latest" type="button" aria-label={t("chat.backToLatest")} title={t("chat.backToLatest")} onClick={() => {
          setAutoScroll(true);
          requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }}>
          <ChevronDown size={18} />
        </button>
      )}
      <div className="composer" ref={composerRef}>
        <Composer
          nodeId={nodeId}
          value={input}
          onChange={setInput}
          busy={isBusy}
          stopPending={stopPending}
          placeholder={awaitingApproval ? t("chat.approvalPlaceholder") : isBusy ? t("chat.generatingPlaceholder") : t("chat.inputPlaceholder")}
          topAccessory={(
            <>
              <TodoProgressPanel plan={todoPlan} />
              {awaitingApproval ? (
                <ApprovalPrompt
                  approval={approval}
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
          telemetryLine={<ComposerTelemetryLine metrics={metrics} />}
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
        />
      </div>
    </div>
  );
}
