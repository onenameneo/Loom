import { describe, expect, it } from "vitest";
import { artifactForPath, remarkArtifactLinks } from "./fileArtifacts";

const artifact = {
  id: "artifact_12345678",
  name: "hello-world.docx",
  displayPath: "/Users/neo/articles/hello-world.docx",
  kind: "document" as const,
  operation: "created" as const,
  status: "available" as const,
};

function transform(node: any) {
  remarkArtifactLinks([artifact])(node);
  return node;
}

describe("message artifact links", () => {
  it("linkifies a registered filename in assistant text", () => {
    expect(transform({ type: "paragraph", children: [{ type: "text", value: "已创建 hello-world.docx。" }] }).children).toEqual([
      { type: "text", value: "已创建 " },
      { type: "link", url: "loom-file://artifact/artifact_12345678", children: [{ type: "text", value: "hello-world.docx" }] },
      { type: "text", value: "。" },
    ]);
  });

  it.each(["code", "inlineCode", "link", "image"])("preserves %s content", (type) => {
    const node = { type, value: "hello-world.docx", url: "https://example.com/hello-world.docx", children: [{ type: "text", value: "hello-world.docx" }] };
    expect(transform(structuredClone(node))).toEqual(node);
  });

  it("does not linkify an unregistered path or part of a longer filename", () => {
    const node = { type: "paragraph", children: [{ type: "text", value: "/other/hello-world.docx old-hello-world.docx hello-world.docx2 hello-world.docx.bak" }] };
    expect(transform(structuredClone(node))).toEqual(node);
    expect(artifactForPath("/other/hello-world.docx", [artifact])).toBeUndefined();
  });

  it("does not duplicate an existing Loom link", () => {
    const node = { type: "link", url: "loom-file://artifact/artifact_12345678", children: [{ type: "text", value: artifact.name }] };
    expect(transform(structuredClone(node))).toEqual(node);
  });
});
