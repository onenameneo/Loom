import { describe, expect, it } from "vitest";
import {
  artifactLink,
  parseArtifactActionRequest,
  parseFileArtifactRef,
  parseFileArtifactRecords,
} from "./fileArtifacts";

describe("file artifact contracts", () => {
  it("parses a renderer-safe artifact reference without an absolute path", () => {
    expect(parseFileArtifactRef({
      id: "artifact_12345678",
      name: "hello-world.docx",
      displayPath: "articles/hello-world.docx",
      kind: "document",
      operation: "created",
      status: "available",
      project: { projectId: "project-1", root: "project:0", path: "articles/hello-world.docx" },
    })).toMatchObject({ id: "artifact_12345678", name: "hello-world.docx", status: "available" });
  });

  it("rejects malformed ids and raw paths in action requests", () => {
    expect(() => parseArtifactActionRequest({ id: "../etc/passwd", action: "open" })).toThrow();
    expect(() => parseArtifactActionRequest({ id: "artifact_12345678", action: "open", path: "/tmp/file" })).toThrow();
  });

  it("creates a Loom-owned link and hides internal record paths from public refs", () => {
    const records = parseFileArtifactRecords([{
      id: "artifact_12345678",
      name: "report.pdf",
      displayPath: "/tmp/report.pdf",
      absolutePath: "/tmp/report.pdf",
      kind: "document",
      operation: "created",
      version: "v1",
    }]);
    expect(records[0]).not.toHaveProperty("absolutePath");
    expect(artifactLink(records[0])).toBe("loom-file://artifact/artifact_12345678");
  });
});
