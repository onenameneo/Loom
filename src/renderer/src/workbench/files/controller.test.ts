import { describe, expect, it, vi } from "vitest";
import type { FileListResult, FilePreviewResult } from "../../../../common/filePreview";
import { FilePreviewController } from "./controller";

function listResult(projectId: string, path: string): FileListResult {
  return { projectId, root: "project:0", path, entries: [], truncated: false };
}

function previewResult(path: string): FilePreviewResult {
  return { projectId: "project-1", root: "project:0", path, name: path, size: 1, kind: "text", content: path, language: "plaintext", version: "v1", truncated: false };
}

describe("FilePreviewController", () => {
  it("loads and expands child directories without replacing the root tree", async () => {
    const api = {
      list: vi.fn(async (request: { path?: string }) => request.path === "src"
        ? { ...listResult("project-1", "src"), entries: [{ name: "App.tsx", path: "src/App.tsx", kind: "file" as const }] }
        : { ...listResult("project-1", "."), entries: [{ name: "src", path: "src", kind: "directory" as const }] }),
      preview: vi.fn(),
      search: vi.fn(),
    };
    const controller = new FilePreviewController(api);
    controller.setProject("project-1");
    await Promise.resolve();
    await (controller as any).toggleDirectory({ name: "src", path: "src", kind: "directory" });

    const treeState = controller.getSnapshot() as any;
    expect(treeState.directories[""].entries).toHaveLength(1);
    expect(treeState.directories.src.entries[0].path).toBe("src/App.tsx");
    expect(treeState.expandedPaths).toContain("src");
  });

  it("searches file names independently from the expanded tree", async () => {
    const api = {
      list: vi.fn(async () => listResult("project-1", ".")),
      preview: vi.fn(),
      search: vi.fn(async () => ({ projectId: "project-1", root: "project:0", query: "app", entries: [{ name: "App.tsx", path: "src/App.tsx", kind: "file" as const }], truncated: false })),
    };
    const controller = new FilePreviewController(api);
    controller.setProject("project-1");
    await (controller as any).search("app");

    expect(api.search).toHaveBeenCalledWith({ projectId: "project-1", root: "project:0", query: "app" });
    expect((controller.getSnapshot() as any).searchResults[0].path).toBe("src/App.tsx");
  });

  it("continues the initial directory load across React StrictMode effect replay", async () => {
    let resolveList!: (result: FileListResult) => void;
    const api = { list: vi.fn(() => new Promise<FileListResult>((resolve) => { resolveList = resolve; })), preview: vi.fn() };
    const controller = new FilePreviewController(api);

    controller.setProject("project-1");
    controller.dispose();
    controller.setProject("project-1");
    resolveList({ ...listResult("project-1", "."), entries: [{ name: "src", path: "src", kind: "directory" }] });
    await Promise.resolve();

    expect(controller.getSnapshot().loading).toBe(false);
    expect(controller.getSnapshot().entries).toHaveLength(1);
  });

  it("ignores stale directory responses when the project changes", async () => {
    const pending: Array<(result: FileListResult) => void> = [];
    const api = { list: vi.fn(() => new Promise<FileListResult>((resolve) => pending.push(resolve))), preview: vi.fn() };
    const controller = new FilePreviewController(api);

    controller.setProject("project-1");
    controller.setProject("project-2");
    pending[0](listResult("project-1", "old"));
    pending[1](listResult("project-2", "new"));
    await Promise.allSettled([Promise.resolve()]);

    expect(controller.getSnapshot().projectId).toBe("project-2");
    expect(controller.getSnapshot().path).toBe("new");
  });

  it("keeps the newest file preview when reads complete out of order", async () => {
    const pending: Array<(result: FilePreviewResult) => void> = [];
    const api = { list: vi.fn(async (request: any) => listResult(request.projectId, "")), preview: vi.fn(() => new Promise<FilePreviewResult>((resolve) => pending.push(resolve))) };
    const controller = new FilePreviewController(api);
    controller.setProject("project-1");
    await Promise.resolve();

    void controller.previewPath("old.ts");
    void controller.previewPath("new.ts");
    pending[0](previewResult("old.ts"));
    pending[1](previewResult("new.ts"));
    await Promise.allSettled([Promise.resolve()]);

    expect(controller.getSnapshot().selectedPath).toBe("new.ts");
    expect(controller.getSnapshot().preview?.path).toBe("new.ts");
  });
});
