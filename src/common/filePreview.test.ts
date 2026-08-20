import { describe, expect, it } from "vitest";
import { parseFileListResult, parseFilePreviewResult, parseFileSearchRequest, parseFileWorkspaceRequest } from "./filePreview";

describe("file preview IPC contract", () => {
  it("rejects malformed or unsafe workspace requests", () => {
    expect(() => parseFileWorkspaceRequest({ projectId: "", root: "project:0" })).toThrow();
    expect(() => parseFileWorkspaceRequest({ projectId: "p", root: "project:0", path: "../secret\0.txt" })).toThrow();
    expect(parseFileWorkspaceRequest({ projectId: "p", root: "project:0", path: "src/App.tsx" })).toEqual({ projectId: "p", root: "project:0", path: "src/App.tsx" });
    expect(parseFileSearchRequest({ projectId: "p", root: "project:0", query: "App" })).toEqual({ projectId: "p", root: "project:0", query: "App" });
  });

  it("validates bounded list and preview result shapes before exposing them to the renderer", () => {
    expect(parseFileListResult({ projectId: "p", root: "project:0", path: ".", entries: [], truncated: false })).toMatchObject({ entries: [], truncated: false });
    expect(parseFilePreviewResult({ projectId: "p", root: "project:0", path: "App.tsx", name: "App.tsx", size: 1, kind: "text", content: "x", language: "typescript", version: "v1", truncated: false })).toMatchObject({ kind: "text", version: "v1" });
    expect(() => parseFilePreviewResult({ projectId: "p", root: "project:0", path: "App.tsx", name: "App.tsx", size: -1, kind: "text", content: "x", language: "typescript", version: "v1", truncated: false })).toThrow();
  });
});
