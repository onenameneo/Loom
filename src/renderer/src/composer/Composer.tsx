import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type ClipboardEvent } from "react";
import { BookOpen, Brain, ChevronDown, FileText, Folder, FolderOpen, Square, X } from "lucide-react";
import { Popover, Slider } from "radix-ui";
import type { FileCandidate, FileMentionRef } from "../../../common/fileMentions";
import type { SelectionContextNote } from "../../../common/selectionContext";
import type { ModelListItem, SkillEffectiveDto, ThinkingLevel } from "../env";
import { IconSend } from "../icons";
import type { CmdCtx } from "./commands";
import { CommandMenu } from "./CommandMenu";
import { SlashPalette, type SlashPaletteHandle } from "./SlashPalette";
import { findFileMentionTrigger } from "./fileMentionParser";
import { ContextBudgetIndicator } from "./ContextBudgetIndicator";
import { useComposerBudget } from "./useComposerBudget";
import { useI18n } from "../i18n/I18nProvider";
import { SelectionNotesPopover } from "./SelectionContextNotes";

export type ComposerImage = { data: string; mimeType: string };
type ComposerSubmitResult = { ok: boolean; reason?: string; errors?: Array<{ path: string; message: string }> };

function defaultThinkingLevel(model: ModelListItem): ThinkingLevel {
  const configured = model.capabilities?.thinkingLevels?.filter((level): level is ThinkingLevel =>
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level),
  );
  if (configured?.length) return configured.find((level) => level !== "off") ?? "off";
  return model.capabilities?.reasoning ? "minimal" : "off";
}

export function Composer({
  nodeId,
  value,
  onChange,
  busy,
  stopPending = false,
  placeholder,
  canRegenerate,
  model,
  thinkingLevel,
  telemetryLine,
  activeSkills,
  topAccessory,
  onSubmit,
  onStop,
  onOpenPersona,
  onClearNode,
  onRegenerate,
  onSetModel,
  onSetThinkingLevel = () => {},
  onCompact,
  onEnableSkill,
  onDisableSkill,
  budgetRefreshKey,
  selectionNotes = [],
  onSelectionNotesChange = () => {},
}: {
  nodeId: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  stopPending?: boolean;
  placeholder: string;
  canRegenerate: boolean;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  telemetryLine?: ReactNode;
  activeSkills?: SkillEffectiveDto[];
  topAccessory?: ReactNode;
  onSubmit: (text: string, images: ComposerImage[], skillIds: string[], mentions: FileMentionRef[], selectionNotes?: SelectionContextNote[]) => void | Promise<ComposerSubmitResult>;
  onStop: () => void;
  onOpenPersona: () => void;
  onClearNode: () => void;
  onRegenerate: () => void;
  onSetModel: (model: string) => void;
  onSetThinkingLevel?: (level: ThinkingLevel) => void;
  onCompact: () => void;
  onEnableSkill?: (skillId: string) => void;
  onDisableSkill?: (skillId: string) => void;
  budgetRefreshKey?: string | number;
  selectionNotes?: SelectionContextNote[];
  onSelectionNotesChange?: (notes: SelectionContextNote[]) => void;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slashRef = useRef<SlashPaletteHandle>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<FileMentionRef[]>([]);
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const [fileCandidates, setFileCandidates] = useState<FileCandidate[]>([]);
  const [fileCandidatesLoading, setFileCandidatesLoading] = useState(false);
  const [fileCandidatesError, setFileCandidatesError] = useState<string | null>(null);
  const [fileCandidatesUnavailable, setFileCandidatesUnavailable] = useState(false);
  const [fileCandidateActive, setFileCandidateActive] = useState(0);
  const [fileMentionDismissed, setFileMentionDismissed] = useState(false);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelListItem[]>([]);
  const composingRef = useRef(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelActive, setModelActive] = useState(0);
  const modelRootRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const fileMentionListId = useId();
  const [isComposing, setIsComposing] = useState(false);
  const fileMentionTrigger = useMemo(() => findFileMentionTrigger(value, cursorPosition), [cursorPosition, value]);
  const fileMentionOpen = Boolean(fileMentionTrigger && !fileMentionDismissed && !busy && !slashOpen && !isComposing);
  const fileCandidateGroups = useMemo(() => {
    const roots = new Map<string, { root: string; rootName: string; directories: Map<string, FileCandidate[]> }>();
    for (const candidate of fileCandidates) {
      const root = roots.get(candidate.root) ?? { root: candidate.root, rootName: candidate.rootName, directories: new Map() };
      const parts = candidate.path.split("/");
      const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : t("composer.projectRoot");
      const files = root.directories.get(directory) ?? [];
      files.push(candidate);
      root.directories.set(directory, files);
      roots.set(candidate.root, root);
    }
    return [...roots.values()].map((root) => ({
      ...root,
      directories: [...root.directories.entries()].map(([directory, candidates]) => ({ directory, candidates })),
    }));
      }, [fileCandidates, t]);

  useEffect(() => {
    if (!fileMentionOpen || !fileMentionTrigger || !window.api) {
      setFileCandidates([]);
      setFileCandidatesError(null);
      setFileCandidatesUnavailable(false);
      setFileCandidatesLoading(false);
      return;
    }
    setFileCandidateActive(0);
    setFileCandidatesLoading(true);
    setFileCandidatesError(null);
    setFileCandidatesUnavailable(false);
    const timer = window.setTimeout(() => {
      window.api.canvas.fileCandidates(nodeId, fileMentionTrigger.query).then((result) => {
        if (!result.ok) throw new Error(result.reason || t("composer.searchFilesFailed"));
        setFileCandidates(result.candidates ?? []);
        setFileCandidatesUnavailable(result.reason === "no-source-roots");
      }).catch((error) => {
        setFileCandidates([]);
        setFileCandidatesError(error instanceof Error ? error.message : t("composer.searchFilesFailed"));
      }).finally(() => setFileCandidatesLoading(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fileMentionOpen, fileMentionTrigger, nodeId]);

  const attachImage = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const ctx = useMemo<CmdCtx>(
    () => ({
      nodeId,
      attachImage,
      openPersona: onOpenPersona,
      clearNode: onClearNode,
      regenerate: onRegenerate,
      setModel: onSetModel,
      compact: onCompact,
      enableSkill: onEnableSkill,
      getState: () => ({ canRegenerate }),
    }),
    [attachImage, canRegenerate, nodeId, onClearNode, onCompact, onEnableSkill, onOpenPersona, onRegenerate, onSetModel],
  );

  useEffect(() => {
    if (!slashOpen || !value.startsWith("/model")) return;
    let alive = true;
    window.api?.canvas.models().then((items) => {
      if (alive) setModelOptions(items);
    });
    return () => {
      alive = false;
    };
  }, [slashOpen, value]);

  useEffect(() => {
    let alive = true;
    window.api?.canvas.models().then((items) => {
      if (alive) setModelOptions(items);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!modelOpen) return;
    requestAnimationFrame(() => {
      modelMenuRef.current?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelRootRef.current?.contains(target)) setModelOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [modelOpen]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<ComposerImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
              const result = String(reader.result ?? "");
              resolve({ mimeType: file.type || "image/png", data: result.replace(/^data:[^;]+;base64,/, "") });
            };
            reader.readAsDataURL(file);
          }),
      ),
    );
    setImages((current) => current.concat(next));
  }

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      event.preventDefault();
      try {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        void onFiles(dt.files);
      } catch {
        onFiles(files as unknown as FileList);
      }
    },
    [onFiles],
  );

  function selectModel(model: ModelListItem) {
    onSetModel(model.id);
    onSetThinkingLevel(defaultThinkingLevel(model));
  }

  const currentModel = useMemo(() => {
    if (!model) return undefined;
    return modelOptions.find((item) => item.id === model || `${item.providerId ?? ""}/${item.modelId ?? ""}` === model);
  }, [model, modelOptions]);

  const thinkingOptions = useMemo<ThinkingLevel[]>(() => {
    const configured = currentModel?.capabilities?.thinkingLevels?.filter((level): level is ThinkingLevel =>
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level),
    );
    if (configured?.length) return configured;
    if (currentModel?.capabilities?.reasoning) return ["off", "minimal", "low", "medium", "high"];
    return ["off"];
  }, [currentModel]);

  const defaultLevel = thinkingOptions.find((level) => level !== "off") ?? "off";
  const effectiveThinkingLevel = thinkingLevel && thinkingOptions.includes(thinkingLevel) ? thinkingLevel : defaultLevel;
  const thinkingDisabled = thinkingOptions.length <= 1;
  const modelLabel = model ?? t("composer.noModels");
  const thinkingActiveIndex = Math.max(0, thinkingOptions.indexOf(effectiveThinkingLevel));

  function selectThinkingLevel(level: ThinkingLevel) {
    onSetThinkingLevel(level);
  }

  const budgetPreview = useMemo(() => ({
    text: value,
    images,
    skillIds: (activeSkills ?? []).map((skill) => skill.id),
    mentions,
    selectionNotes,
  }), [activeSkills, images, mentions, selectionNotes, value]);
  const { budget } = useComposerBudget(nodeId, budgetPreview, `${model ?? ""}:${busy ? "busy" : "idle"}:${budgetRefreshKey ?? ""}`);

  function selectThinkingIndex(index: number) {
    const level = thinkingOptions[index];
    if (level) selectThinkingLevel(level);
  }

  useEffect(() => {
    if (currentModel && thinkingLevel === undefined && defaultLevel !== "off") onSetThinkingLevel(defaultLevel);
  }, [currentModel, defaultLevel, onSetThinkingLevel, thinkingLevel]);

  function submit() {
    const text = value.trim();
    if (busy || (!text && images.length === 0 && mentions.length === 0 && selectionNotes.length === 0)) return;
    const submittedImages = images;
    const submittedMentions = mentions;
    const submittedSelectionNotes = selectionNotes;
    const result = submittedSelectionNotes.length > 0
      ? onSubmit(text, submittedImages, (activeSkills ?? []).map((skill) => skill.id), submittedMentions, submittedSelectionNotes)
      : onSubmit(text, submittedImages, (activeSkills ?? []).map((skill) => skill.id), submittedMentions);
    setImages([]);
    setMentions([]);
    onSelectionNotesChange([]);
    setSlashOpen(false);
    if (result && typeof (result as Promise<ComposerSubmitResult>).then === "function") {
      void (result as Promise<ComposerSubmitResult>).then((response) => {
        if (response && !response.ok) {
          setImages(submittedImages);
          setMentions(submittedMentions);
          onSelectionNotesChange(submittedSelectionNotes);
        }
      });
    }
  }

  const sendDisabled = !busy && !value.trim() && images.length === 0 && mentions.length === 0 && selectionNotes.length === 0;

  function selectFileCandidate(candidate: FileCandidate) {
    if (!fileMentionTrigger) return;
    const next = `${value.slice(0, fileMentionTrigger.start)}${value.slice(fileMentionTrigger.end)}`;
    const mention: FileMentionRef = { root: candidate.root, path: candidate.path };
    setFileMentionDismissed(false);
    setMentions((current) => current.some((item) => item.root === mention.root && item.path === mention.path) ? current : [...current, mention]);
    onChange(next);
    setCursorPosition(fileMentionTrigger.start);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      target?.focus();
      target?.setSelectionRange(fileMentionTrigger.start, fileMentionTrigger.start);
    });
  }

  function removeFileMention(mention: FileMentionRef) {
    setMentions((current) => current.filter((item) => item.root !== mention.root || item.path !== mention.path));
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      target?.focus({ preventScroll: true });
    });
  }

  function closeFileMention() {
    setFileMentionDismissed(true);
  }

  function handleFileMentionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!fileMentionOpen) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFileCandidateActive((index) => (fileCandidates.length ? (index + 1) % fileCandidates.length : 0));
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFileCandidateActive((index) => (fileCandidates.length ? (index - 1 + fileCandidates.length) % fileCandidates.length : 0));
      return true;
    }
    if (event.key === "Enter" && fileCandidates[fileCandidateActive]) {
      event.preventDefault();
      selectFileCandidate(fileCandidates[fileCandidateActive]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeFileMention();
      return true;
    }
    return false;
  }

  return (
    <div className="composer-wrap nodrag flex w-full flex-col gap-loom-1 box-border">
      {topAccessory}
      <div className="composer-box relative flex w-full flex-col gap-loom-1 box-border rounded-loom-lg border border-loom-border bg-loom-surface px-3 py-loom-1 shadow-loom-composer focus-within:border-loom-accent focus-within:shadow-[0_0_0_1px_var(--accent-soft),var(--shadow-composer)]">
        <SlashPalette
          ref={slashRef}
          value={slashOpen ? value : ""}
          setValue={(next) => {
            onChange(next);
            setCommandError(null);
          }}
          ctx={ctx}
          modelOptions={modelOptions}
          onClose={() => setSlashOpen(false)}
          onNoMatch={() => {
            setSlashOpen(false);
            submit();
          }}
          onUnknownCommand={(message) => {
            setCommandError(message);
            setSlashOpen(false);
          }}
        />
        {activeSkills && activeSkills.length > 0 && (
          <div className="composer-skills" aria-label={t("composer.enabledSkills")}>
            {activeSkills.map((skill) => (
              <span className="composer-skill" key={`${skill.sourcePath}:${skill.id}`} title={`${skill.name} · ${skill.hash}`}>
                <BookOpen size={13} />
                {skill.name}
                {onDisableSkill && (
                  <button
                    type="button"
                    className="composer-skill__remove"
                    aria-label={`${t("composer.disableSkill")} ${skill.name}`}
                    title={t("composer.disableSkill")}
                    onClick={() => onDisableSkill(skill.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((image, index) => (
              <span className="composer-image" key={`${image.mimeType}-${index}`}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
                <button type="button" title={t("composer.removeImage")} onClick={() => setImages((items) => items.filter((_, i) => i !== index))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {mentions.length > 0 && (
          <div className="composer-file-mentions" aria-label={t("composer.referencedFiles")}>
            {mentions.map((mention) => {
              const fileName = mention.path.split("/").pop() || mention.path;
              return (
                <span className="composer-file-mention" key={`${mention.root}:${mention.path}`}>
                  <FileText size={12} aria-hidden="true" />
                  <span className="composer-file-mention__path" title={`@${mention.path}`}>@{fileName}</span>
                  <button
                    type="button"
                    aria-label={`${t("composer.removeFile")} ${mention.path}`}
                    title={t("composer.removeFile")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removeFileMention(mention)}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <SelectionNotesPopover notes={selectionNotes} onChange={onSelectionNotesChange} />
        <Popover.Root
          modal={false}
          open={fileMentionOpen}
          onOpenChange={(open) => {
            if (!open) closeFileMention();
          }}
        >
          <Popover.Anchor asChild>
            <div className="composer-textarea-anchor">
              <textarea
                ref={textareaRef}
                className="ask"
                rows={1}
                placeholder={placeholder}
                value={value}
                disabled={busy}
                role="combobox"
                aria-autocomplete="list"
                aria-controls={fileMentionListId}
                aria-expanded={fileMentionOpen}
                aria-haspopup="listbox"
                onChange={(event) => {
                  const next = event.target.value;
                  onChange(next);
                  setCursorPosition(event.target.selectionStart);
                  setFileMentionDismissed(false);
                  setCommandError(null);
                  setSlashOpen(next.startsWith("/"));
                }}
                onSelect={(event) => setCursorPosition(event.currentTarget.selectionStart)}
                onFocus={() => {
                  setCursorPosition(textareaRef.current?.selectionStart ?? value.length);
                  setFileMentionDismissed(false);
                  setSlashOpen(value.startsWith("/"));
                }}
                onPaste={handlePaste}
                onBlur={() => window.setTimeout(() => setSlashOpen(false), 120)}
                onCompositionStart={() => {
                  composingRef.current = true;
                  setIsComposing(true);
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                  setIsComposing(false);
                }}
                onKeyDown={(event) => {
                  const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
                  const isComposing = composingRef.current || event.nativeEvent.isComposing || nativeEvent.keyCode === 229;
                  if (isComposing) return;
                  if (handleFileMentionKeyDown(event)) return;
                  if (slashOpen && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                    slashRef.current?.handleKeyDown(event);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              id={fileMentionListId}
              role="listbox"
              aria-label={t("composer.projectFiles")}
              className="composer-popover file-mention-popover nodrag"
              side="top"
              align="start"
              sideOffset={8}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                const target = event.target;
                if (target instanceof Node && textareaRef.current?.contains(target)) event.preventDefault();
              }}
            >
              <div className="file-mention-title">{t("composer.projectFiles")}</div>
              {fileCandidatesLoading && <div className="cmd-empty">{t("composer.searching")}</div>}
              {!fileCandidatesLoading && fileCandidatesError && <div className="cmd-empty file-mention-error">{fileCandidatesError}</div>}
              {!fileCandidatesLoading && !fileCandidatesError && fileCandidatesUnavailable && (
                <div className="file-mention-unavailable">
                  <FolderOpen size={16} aria-hidden="true" />
                  <strong>{t("composer.noProjectDirectory")}</strong>
                  <span>{t("composer.projectFilesOnly")}</span>
                  <small>{t("composer.linkDirectoryFirst")}</small>
                </div>
              )}
              {!fileCandidatesLoading && !fileCandidatesError && !fileCandidatesUnavailable && fileCandidates.length === 0 && <div className="cmd-empty">{t("composer.noMatchingFiles")}</div>}
              {!fileCandidatesLoading && !fileCandidatesError && !fileCandidatesUnavailable && fileCandidateGroups.map((root) => (
                <div className="file-mention-root" key={root.root}>
                  <div className="file-mention-root__header">
                    <FolderOpen size={13} aria-hidden="true" />
                    <span>{root.rootName}</span>
                    <small>{root.root}</small>
                  </div>
                  {root.directories.map((directory) => (
                    <div className="file-mention-directory-group" key={`${root.root}:${directory.directory}`}>
                      <div className="file-mention-directory-heading">
                        <Folder size={12} aria-hidden="true" />
                        <span>{directory.directory}</span>
                      </div>
                      {directory.candidates.map((candidate) => {
                        const index = fileCandidates.findIndex((item) => item.root === candidate.root && item.path === candidate.path);
                        const parts = candidate.path.split("/");
                        const fileName = parts[parts.length - 1] ?? candidate.path;
                        return (
                          <button
                            key={`${candidate.root}:${candidate.path}`}
                            type="button"
                            role="option"
                            aria-selected={index === fileCandidateActive}
                            className={`cmd-row file-mention-row ${index === fileCandidateActive ? "is-active" : ""}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setFileCandidateActive(index)}
                            onClick={() => selectFileCandidate(candidate)}
                          >
                            <span className="file-mention-path">
                              <FileText size={12} aria-hidden="true" />
                              <strong>{fileName}</strong>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="composer-hint mt-[-2px] select-none font-loom-mono text-[10px] text-loom-faint">{t("composer.openCommand")}</div>
        {commandError && <div className="composer-command-error text-[11px] leading-[1.35] text-loom-err" role="alert">{commandError}</div>}
        <div className="composer-bar flex min-w-0 items-center gap-loom-2">
          <input
            ref={fileRef}
            className="composer-file"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <CommandMenu ctx={ctx} />
          <div className="model-switcher-root nodrag" ref={modelRootRef}>
            <button
              type="button"
              className={`model-switcher ${modelOpen ? "is-open" : ""}`}
              title={`${modelLabel} · ${effectiveThinkingLevel}`}
              aria-label={`${modelLabel} · ${effectiveThinkingLevel}`}
              aria-haspopup="menu"
              aria-expanded={modelOpen}
              onClick={() => {
                setModelActive(0);
                setModelOpen((v) => !v);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setModelActive(0);
                  setModelOpen(true);
                }
              }}
            >
              <span className="model-switcher__label">{modelLabel}</span>
              <span className="model-switcher__thinking">{effectiveThinkingLevel}</span>
              <ChevronDown size={13} />
            </button>
            {modelOpen && (
              <div
                ref={modelMenuRef}
                className="composer-popover model-switcher-menu"
                role="menu"
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setModelActive((i) => (i + 1) % modelOptions.length);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setModelActive((i) => (i - 1 + modelOptions.length) % modelOptions.length);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const item = modelOptions[modelActive];
                    if (item) selectModel(item);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setModelOpen(false);
                  }
                }}
              >
                <div className="model-switcher-list" role="group" aria-label="Models">
                  {modelOptions.length === 0 && <div className="cmd-empty">{t("composer.noModels")}</div>}
                  {modelOptions.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className={`cmd-row ${index === modelActive ? "is-active" : ""}`}
                      onMouseEnter={() => setModelActive(index)}
                      onClick={() => selectModel(item)}
                    >
                      <span>{item.name || item.id}</span>
                      <small>{item.providerId ?? ""}</small>
                    </button>
                  ))}
                </div>
                <div className="model-switcher-thinking" role="group" aria-label="Thinking">
                  <div className="model-switcher-thinking-label">
                    <Brain size={15} />
                    <span>Thinking</span>
                    <small>({effectiveThinkingLevel})</small>
                  </div>
                  <div className="model-switcher-thinking-slider-shell">
                    <Slider.Root
                      className="model-switcher-thinking-slider"
                      aria-label="Thinking level"
                      min={0}
                      max={Math.max(1, thinkingOptions.length - 1)}
                      step={1}
                      value={[thinkingActiveIndex]}
                      disabled={thinkingDisabled}
                      onValueChange={([next]) => selectThinkingIndex(next ?? 0)}
                    >
                      <Slider.Track className="model-switcher-thinking-slider-track">
                        <Slider.Range className="model-switcher-thinking-slider-range" />
                      </Slider.Track>
                      <Slider.Thumb className="model-switcher-thinking-slider-thumb" title={`Thinking ${effectiveThinkingLevel}`} />
                    </Slider.Root>
                  </div>
                </div>
              </div>
            )}
          </div>
          <ContextBudgetIndicator budget={budget} onCompact={onCompact} compactBusy={busy} />
          <button
            type="button"
            className={`round-send ${busy ? "is-stop" : ""}`}
            onClick={busy ? onStop : submit}
            disabled={sendDisabled || stopPending}
            title={busy ? t("common.stop") : t("common.send")}
          >
            {busy ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <IconSend />}
          </button>
        </div>
      </div>
      {telemetryLine}
    </div>
  );
}
