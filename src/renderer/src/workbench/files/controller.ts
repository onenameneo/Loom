import type { FileEntry, FileListResult, FilePreviewResult, FileSearchResult, FileWorkspaceRequest } from "../../../../common/filePreview";

export interface FilesApi {
  list(request: FileWorkspaceRequest): Promise<FileListResult>;
  search?(request: { projectId: string; root: string; query: string }): Promise<FileSearchResult>;
  preview(request: FileWorkspaceRequest): Promise<FilePreviewResult>;
  open?(request: FileWorkspaceRequest): Promise<{ ok: boolean; error?: string }>;
}

export interface FileDirectoryState {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export interface FileWorkspaceState {
  projectId: string | null;
  root: string;
  path: string;
  parent?: string;
  entries: FileEntry[];
  truncated: boolean;
  selectedPath: string | null;
  preview: FilePreviewResult | null;
  loading: boolean;
  previewLoading: boolean;
  error: string | null;
  previewError: string | null;
  directories: Record<string, FileDirectoryState>;
  expandedPaths: string[];
  searchQuery: string;
  searchResults: FileEntry[] | null;
  searchLoading: boolean;
  searchError: string | null;
}

const initialState: FileWorkspaceState = {
  projectId: null,
  root: "project:0",
  path: "",
  entries: [],
  truncated: false,
  selectedPath: null,
  preview: null,
  loading: false,
  previewLoading: false,
  error: null,
  previewError: null,
  directories: {},
  expandedPaths: [],
  searchQuery: "",
  searchResults: null,
  searchLoading: false,
  searchError: null,
};

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : "文件工作区暂时不可用。";
}

function relativePath(path: string): string | undefined {
  return path.length > 0 ? path : undefined;
}

function normalizedPath(path: string): string {
  return path === "." ? "" : path;
}

function directoryState(result: FileListResult): FileDirectoryState {
  return {
    path: normalizedPath(result.path),
    entries: result.entries,
    truncated: result.truncated,
    loading: false,
    error: null,
  };
}

export class FilePreviewController {
  private state: FileWorkspaceState = initialState;
  private listeners = new Set<() => void>();
  private directoryRevisions = new Map<string, number>();
  private projectRevision = 0;
  private previewRevision = 0;
  private searchRevision = 0;
  private disposed = false;

  constructor(private readonly api: FilesApi | undefined) {}

  getSnapshot = (): FileWorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<FileWorkspaceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  setProject(projectId: string | null, root = "project:0") {
    // React StrictMode replays effects during development. The replay invokes
    // the cleanup once and then re-runs this method on the same controller;
    // revive that instance so the already-issued request can settle.
    this.disposed = false;
    if (this.state.projectId === projectId && this.state.root === root) return;
    this.projectRevision += 1;
    this.directoryRevisions.clear();
    this.previewRevision += 1;
    this.searchRevision += 1;
    this.update({ ...initialState, projectId, root });
    if (projectId) void this.loadDirectory();
  }

  setSearchQuery(query: string) {
    this.update({ searchQuery: query });
  }

  async loadDirectory(path = this.state.path) {
    const directoryPath = normalizedPath(path);
    const projectId = this.state.projectId;
    const projectRevision = this.projectRevision;
    if (!projectId || !this.api) {
      this.update({ loading: false, error: projectId ? "文件预览需要 Electron 文件桥接。" : null });
      return;
    }
    const revision = (this.directoryRevisions.get(directoryPath) ?? 0) + 1;
    this.directoryRevisions.set(directoryPath, revision);
    const previousDirectory = this.state.directories[directoryPath];
    this.update({
      loading: directoryPath === this.state.path,
      error: directoryPath === this.state.path ? null : this.state.error,
      directories: {
        ...this.state.directories,
        [directoryPath]: {
          path: directoryPath,
          entries: previousDirectory?.entries ?? [],
          truncated: previousDirectory?.truncated ?? false,
          loading: true,
          error: null,
        },
      },
    });
    try {
      const result = await this.api.list({ projectId, root: this.state.root, path: relativePath(directoryPath) });
      if (this.disposed || projectRevision !== this.projectRevision || revision !== this.directoryRevisions.get(directoryPath) || result.projectId !== projectId) return;
      const loadedDirectory = directoryState(result);
      const isCurrentDirectory = directoryPath === this.state.path;
      this.update({
        path: isCurrentDirectory ? loadedDirectory.path : this.state.path,
        parent: result.parent === "." ? "" : result.parent,
        entries: isCurrentDirectory ? loadedDirectory.entries : this.state.entries,
        truncated: isCurrentDirectory ? loadedDirectory.truncated : this.state.truncated,
        loading: isCurrentDirectory ? false : this.state.loading,
        error: isCurrentDirectory ? null : this.state.error,
        directories: { ...this.state.directories, [loadedDirectory.path]: loadedDirectory },
      });
    } catch (error) {
      if (this.disposed || projectRevision !== this.projectRevision || revision !== this.directoryRevisions.get(directoryPath)) return;
      const message = displayError(error);
      this.update({
        loading: directoryPath === this.state.path ? false : this.state.loading,
        error: directoryPath === this.state.path ? message : this.state.error,
        entries: directoryPath === this.state.path ? [] : this.state.entries,
        directories: {
          ...this.state.directories,
          [directoryPath]: { path: directoryPath, entries: [], truncated: false, loading: false, error: message },
        },
      });
    }
  }

  async toggleDirectory(entry: FileEntry) {
    if (entry.kind !== "directory") return;
    if (this.state.expandedPaths.includes(entry.path)) {
      this.update({ expandedPaths: this.state.expandedPaths.filter((path) => path !== entry.path) });
      return;
    }
    this.update({ expandedPaths: [...this.state.expandedPaths, entry.path] });
    const directory = this.state.directories[entry.path];
    if (!directory || directory.error) await this.loadDirectory(entry.path);
  }

  async openEntry(entry: FileEntry) {
    if (entry.kind === "directory") {
      this.previewRevision += 1;
      this.update({ selectedPath: null, preview: null, previewError: null });
      await this.toggleDirectory(entry);
      return;
    }
    await this.previewPath(entry.path);
  }

  async search(query: string) {
    const normalizedQuery = query.trim();
    this.searchRevision += 1;
    const revision = this.searchRevision;
    this.update({ searchQuery: query });
    if (!normalizedQuery) {
      this.update({ searchResults: null, searchLoading: false, searchError: null });
      return;
    }
    const projectId = this.state.projectId;
    if (!projectId || !this.api?.search) {
      this.update({ searchResults: [], searchLoading: false, searchError: "文件搜索需要 Electron 文件桥接。" });
      return;
    }
    this.update({ searchLoading: true, searchError: null });
    try {
      const result = await this.api.search({ projectId, root: this.state.root, query: normalizedQuery });
      if (this.disposed || revision !== this.searchRevision || result.projectId !== projectId) return;
      this.update({ searchResults: result.entries, searchLoading: false, searchError: null });
    } catch (error) {
      if (this.disposed || revision !== this.searchRevision) return;
      this.update({ searchResults: [], searchLoading: false, searchError: displayError(error) });
    }
  }

  async previewPath(path: string) {
    const projectId = this.state.projectId;
    if (!projectId || !this.api) return;
    const revision = ++this.previewRevision;
    this.update({ selectedPath: path, preview: null, previewLoading: true, previewError: null });
    try {
      const preview = await this.api.preview({ projectId, root: this.state.root, path });
      if (this.disposed || revision !== this.previewRevision) return;
      this.update({ preview, previewLoading: false, previewError: null });
    } catch (error) {
      if (this.disposed || revision !== this.previewRevision) return;
      this.update({ previewLoading: false, previewError: displayError(error) });
    }
  }

  async refresh() {
    await Promise.all([this.state.path, ...this.state.expandedPaths].filter((path, index, paths) => paths.indexOf(path) === index).map((path) => this.loadDirectory(path)));
    if (this.state.selectedPath) await this.previewPath(this.state.selectedPath);
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}

/** Single structured entry point for Files, Composer, or future agent-reference actions. */
export async function openFilePreview(controller: FilePreviewController, request: FileWorkspaceRequest): Promise<void> {
  controller.setProject(request.projectId, request.root);
  if (request.path) await controller.previewPath(request.path);
}
