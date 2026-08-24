import type { FileArtifactRef } from "../../../common/fileArtifacts";
import { artifactLink } from "../../../common/fileArtifacts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkifyArtifactText(text: string, artifacts: FileArtifactRef[] = []): string {
  const codeSegments: string[] = [];
  const textOutsideCode = text.replace(/(`{1,3})([\s\S]*?)\1/g, (segment) => {
    const index = codeSegments.push(segment) - 1;
    return `\u0000${index}\u0000`;
  });
  let result = textOutsideCode;
  for (const artifact of [...artifacts].sort((left, right) => right.name.length - left.name.length)) {
    if (!artifact.name || result.includes(artifactLink(artifact))) continue;
    const expression = new RegExp(escapeRegExp(artifact.name), "g");
    result = result.replace(expression, (match, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 1), offset);
      const after = full.slice(offset + match.length, offset + match.length + 2);
      if (before === "[" || after === "](") return match;
      return `[${match}](${artifactLink(artifact)})`;
    });
  }
  return result.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codeSegments[Number(index)] ?? "");
}
