import { describe, expect, it } from "vitest";
import { linkifyArtifactText } from "./fileArtifacts";

const artifact = {
  id: "artifact_12345678",
  name: "hello-world.docx",
  displayPath: "/Users/neo/articles/hello-world.docx",
  kind: "document" as const,
  operation: "created" as const,
  status: "available" as const,
};

describe("message artifact links", () => {
  it("linkifies a registered filename in assistant content", () => {
    expect(linkifyArtifactText("已创建 hello-world.docx。", [artifact])).toBe("已创建 [hello-world.docx](loom-file://artifact/artifact_12345678)。");
  });

  it("does not linkify an unregistered path", () => {
    expect(linkifyArtifactText("/tmp/not-registered.pdf", [artifact])).toBe("/tmp/not-registered.pdf");
  });

  it("does not duplicate an existing Loom link", () => {
    const text = "[hello-world.docx](loom-file://artifact/artifact_12345678)";
    expect(linkifyArtifactText(text, [artifact])).toBe(text);
  });

  it("does not inject Markdown links inside inline or fenced code", () => {
    const text = "`hello-world.docx`\n\n```text\nhello-world.docx\n```";
    expect(linkifyArtifactText(text, [artifact])).toBe(text);
  });
});
