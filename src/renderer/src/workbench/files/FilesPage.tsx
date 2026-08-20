import { ChevronDown, ChevronRight, ExternalLink, File, FileImage, Folder, FolderOpen, LoaderCircle, PanelLeft, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { FileEntry } from "../../../../common/filePreview";
import { FilePreviewPane } from "./FilePreviewPane";
import { FilePreviewController, openFilePreview, type FilesApi } from "./controller";

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

export function FilesPage({ projectId }: { projectId: string | null }) {
  const { controller, snapshot } = useFilesController(projectId);
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

  return <div className="files-page" role="region" aria-label="Files 文件工作区">
    <div className="files-toolbar">
      <div className="files-toolbar__title"><FolderOpen size={14} /><span>Files</span></div>
      <div className="files-toolbar__actions">
        <button className="files-icon-button" type="button" aria-label={explorerCollapsed ? "展开文件列表" : "折叠文件列表"} aria-expanded={!explorerCollapsed} onClick={() => setExplorerCollapsed((collapsed) => !collapsed)}><PanelLeft size={14} /></button>
        <button className="files-icon-button" type="button" aria-label="刷新文件列表" onClick={() => void controller.refresh()}><RefreshCw size={14} /></button>
        <button className="files-icon-button" type="button" aria-label="在系统中打开文件" disabled={!snapshot.selectedPath || !window.api?.files.open} onClick={() => { if (snapshot.selectedPath && window.api?.files.open && projectId) void window.api.files.open({ projectId, root: snapshot.root, path: snapshot.selectedPath }); }}><ExternalLink size={14} /></button>
      </div>
    </div>
    <div ref={workspaceRef} className="files-workspace" data-explorer-collapsed={explorerCollapsed ? "true" : "false"} style={{ "--files-explorer-width": `${splitRef.current}%` } as CSSProperties}>
      <div className="files-explorer" aria-label="文件列表">
        <label className="files-search"><Search size={14} /><input type="search" value={snapshot.searchQuery} placeholder="搜索文件名" aria-label="搜索文件名" onChange={(event) => controller.setSearchQuery(event.target.value)} /></label>
        <div className="files-tree" role="tree" aria-label="项目文件树">
          {snapshot.searchQuery.trim() ? snapshot.searchLoading ? <div className="files-list-status"><LoaderCircle className="animate-spin" size={14} />搜索中…</div> : snapshot.searchError ? <div className="files-list-status files-list-status--error">{snapshot.searchError}</div> : snapshot.searchResults?.length ? renderSearchResults() : <div className="files-list-status">没有匹配的文件。</div> : snapshot.loading ? <div className="files-list-status">读取目录中…</div> : snapshot.error ? <div className="files-list-status files-list-status--error">{snapshot.error}</div> : snapshot.entries.length === 0 ? <div className="files-list-status">{projectId ? "目录为空，或项目尚未配置文件根目录。" : "选择项目后浏览文件。"}</div> : renderTree(snapshot.entries)}
        </div>
        {!snapshot.searchQuery.trim() && snapshot.truncated && <div className="files-list-status">目录过大，仅显示前 500 项。</div>}
      </div>
      <div ref={splitterRef} className="files-splitter" role="separator" aria-label="调整文件列表宽度" aria-orientation="vertical" aria-valuemin={28} aria-valuemax={68} aria-valuenow={Math.round(split)} tabIndex={0} onPointerDown={beginSplitResize} onPointerMove={moveSplitResize} onPointerUp={(event) => finishSplitResize(event.pointerId)} onPointerCancel={(event) => finishSplitResize(event.pointerId)} onLostPointerCapture={() => finishSplitResize()} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); nudgeSplit(-2); } if (event.key === "ArrowRight") { event.preventDefault(); nudgeSplit(2); } }} />
      <div className="files-preview" aria-label="文件预览"><FilePreviewPane preview={snapshot.preview} loading={snapshot.previewLoading} error={snapshot.previewError} /></div>
    </div>
  </div>;
}
