import { ChevronDown, ChevronRight, ExternalLink, File, FileImage, Folder, FolderOpen, LoaderCircle, PanelLeft, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { FileEntry, FileWorkspaceRequest } from "../../../../common/filePreview";
import { FilePreviewPane } from "./FilePreviewPane";
import { FilePreviewController, openFilePreview, type FilesApi } from "./controller";
import { useI18n } from "../../i18n/I18nProvider";

function entryIcon(entry: FileEntry) {
  if (entry.kind === "directory") return <Folder size={14} />;
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name)) return <FileImage size={14} />;
  return <File size={14} />;
}

function useFilesController(projectId: string | null) {
  const controllerRef = useRef<FilePreviewController | null>(null);
  if (!controllerRef.current) controllerRef.current = new FilePreviewController(window.api?.files as FilesApi | undefined);
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.setProject(projectId);
  }, [controller, projectId]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { controller, snapshot };
}

export function FilesPage({ projectId, previewRequest }: { projectId: string | null; previewRequest?: FileWorkspaceRequest | null }) {
  const { t } = useI18n();
  const { controller, snapshot } = useFilesController(projectId);
  useEffect(() => {
    if (previewRequest && previewRequest.projectId === projectId) void openFilePreview(controller, previewRequest);
  }, [controller, previewRequest, projectId]);
  const [split, setSplit] = useState(42);
  const splitRef = useRef(42);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startSplit: number; width: number; latest: number } | null>(null);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => void controller.search(snapshot.searchQuery), 180);
    return () => window.clearTimeout(timer);
  }, [controller, snapshot.searchQuery]);
  const clampSplit = (value: number) => Math.min(68, Math.max(28, value));
  const applySplit = (value: number, commit = false) => {
    const next = clampSplit(value);
    splitRef.current = next;
    workspaceRef.current?.style.setProperty("--files-explorer-width", `${next}%`);
    splitterRef.current?.setAttribute("aria-valuenow", String(Math.round(next)));
    if (commit) setSplit(next);
  };
  const beginSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const width = workspace.getBoundingClientRect().width;
    if (width <= 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    workspace.classList.add("is-resizing");
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startSplit: splitRef.current, width, latest: splitRef.current };
  };
  const moveSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resize.latest = resize.startSplit + ((event.clientX - resize.startX) / resize.width) * 100;
    applySplit(resize.latest);
  };
  const finishSplitResize = (pointerId?: number) => {
    const resize = resizeRef.current;
    if (!resize || (pointerId !== undefined && resize.pointerId !== pointerId)) return;
    resizeRef.current = null;
    applySplit(resize.latest, true);
    workspaceRef.current?.classList.remove("is-resizing");
    if (splitterRef.current?.hasPointerCapture?.(resize.pointerId)) splitterRef.current.releasePointerCapture(resize.pointerId);
  };
  const nudgeSplit = (delta: number) => applySplit(splitRef.current + delta, true);
  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "directory") void controller.toggleDirectory(entry);
    else if (projectId) void openFilePreview(controller, { projectId, root: snapshot.root, path: entry.path });
  };
  const renderTree = (entries: FileEntry[], depth = 0): React.ReactNode => entries.map((entry) => {
    const directory = entry.kind === "directory" ? snapshot.directories[entry.path] : undefined;
    const expanded = snapshot.expandedPaths.includes(entry.path);
    return <div className="files-tree-node" key={entry.path}>
      <button type="button" role="treeitem" aria-level={depth + 1} aria-expanded={entry.kind === "directory" ? expanded : undefined} className={`files-entry${snapshot.selectedPath === entry.path ? " is-selected" : ""}`} onClick={() => openEntry(entry)}>
        {entry.kind === "directory" ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="files-entry__indent" />}
        {entry.kind === "directory" ? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />) : entryIcon(entry)}
        <span>{entry.name}</span>
        {directory?.loading && <LoaderCircle className="files-entry__loading animate-spin" size={12} />}
      </button>
      {expanded && directory && <div className="files-tree-children" role="group">{directory.error ? <div className="files-tree-error">{directory.error}</div> : renderTree(directory.entries, depth + 1)}</div>}
    </div>;
  });
  const renderSearchResults = () => (snapshot.searchResults ?? []).map((entry) => <button type="button" role="treeitem" aria-level={1} className={`files-entry files-search-result${snapshot.selectedPath === entry.path ? " is-selected" : ""}`} key={entry.path} onClick={() => openEntry(entry)}>
    {entryIcon(entry)}<span>{entry.name}</span><small>{entry.path}</small>
  </button>);

  return <div className="files-page" role="region" aria-label={t("files.workspace")}>
    <div className="files-toolbar">
      <div className="files-toolbar__title"><FolderOpen size={14} /><span>Files</span></div>
      <div className="files-toolbar__actions">
        <button className="files-icon-button" type="button" aria-label={explorerCollapsed ? t("files.expandList") : t("files.collapseList")} aria-expanded={!explorerCollapsed} onClick={() => setExplorerCollapsed((collapsed) => !collapsed)}><PanelLeft size={14} /></button>
        <button className="files-icon-button" type="button" aria-label={t("files.refresh")} onClick={() => void controller.refresh()}><RefreshCw size={14} /></button>
        <button className="files-icon-button" type="button" aria-label={t("files.openSystem")} disabled={!snapshot.selectedPath || !window.api?.files.open} onClick={() => { if (snapshot.selectedPath && window.api?.files.open && projectId) void window.api.files.open({ projectId, root: snapshot.root, path: snapshot.selectedPath }); }}><ExternalLink size={14} /></button>
      </div>
    </div>
    <div ref={workspaceRef} className="files-workspace" data-explorer-collapsed={explorerCollapsed ? "true" : "false"} style={{ "--files-explorer-width": `${splitRef.current}%` } as CSSProperties}>
      <div className="files-explorer" aria-label={t("files.list")}>
        <label className="files-search"><Search size={14} /><input type="search" value={snapshot.searchQuery} placeholder={t("files.searchPlaceholder")} aria-label={t("files.searchPlaceholder")} onChange={(event) => controller.setSearchQuery(event.target.value)} /></label>
        <div className="files-tree" role="tree" aria-label={t("files.tree")}>
          {snapshot.searchQuery.trim() ? snapshot.searchLoading ? <div className="files-list-status"><LoaderCircle className="animate-spin" size={14} />{t("composer.searching")}</div> : snapshot.searchError ? <div className="files-list-status files-list-status--error">{snapshot.searchError}</div> : snapshot.searchResults?.length ? renderSearchResults() : <div className="files-list-status">{t("files.noMatches")}</div> : snapshot.loading ? <div className="files-list-status">{t("files.readingDirectory")}</div> : snapshot.error ? <div className="files-list-status files-list-status--error">{snapshot.error}</div> : snapshot.entries.length === 0 ? <div className="files-list-status">{projectId ? t("files.emptyDirectory") : t("files.selectProject")}</div> : renderTree(snapshot.entries)}
        </div>
        {!snapshot.searchQuery.trim() && snapshot.truncated && <div className="files-list-status">{t("files.tooLarge")}</div>}
      </div>
      <div ref={splitterRef} className="files-splitter" role="separator" aria-label={t("layout.resizeFileList")} aria-orientation="vertical" aria-valuemin={28} aria-valuemax={68} aria-valuenow={Math.round(split)} tabIndex={0} onPointerDown={beginSplitResize} onPointerMove={moveSplitResize} onPointerUp={(event) => finishSplitResize(event.pointerId)} onPointerCancel={(event) => finishSplitResize(event.pointerId)} onLostPointerCapture={() => finishSplitResize()} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); nudgeSplit(-2); } if (event.key === "ArrowRight") { event.preventDefault(); nudgeSplit(2); } }} />
      <div className="files-preview" aria-label={t("files.preview")}><FilePreviewPane preview={snapshot.preview} loading={snapshot.previewLoading} error={snapshot.previewError} /></div>
    </div>
  </div>;
}
