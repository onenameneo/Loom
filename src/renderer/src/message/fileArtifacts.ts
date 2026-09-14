import type { FileArtifactRef } from "../../../common/fileArtifacts";
import { artifactLink } from "../../../common/fileArtifacts";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Match registered identities only; a basename must identify exactly one file. */
export function artifactForPath(value: string, artifacts: FileArtifactRef[]): FileArtifactRef | undefined {
  let path = value.trim();
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return undefined;
      path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
    } catch { return undefined; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    return undefined;
  }
  const match = (candidate: string) => {
    const normalized = normalizePath(candidate);
    const matches = artifacts.filter((artifact) => [artifact.name, artifact.displayPath, artifact.project?.path]
      .some((identity) => identity !== undefined && normalizePath(identity) === normalized));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const exact = match(path);
  if (exact) return exact;
  try { return match(decodeURIComponent(path)); } catch { return undefined; }
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

/** Operate on parsed nodes so link destinations, code and images stay intact. */
export function remarkArtifactLinks(artifacts: FileArtifactRef[] = []) {
  const identities = [...new Set(artifacts.flatMap((artifact) => [artifact.displayPath, artifact.project?.path, artifact.name]
    .filter((value): value is string => Boolean(value))))].sort((a, b) => b.length - a.length);
  const expression = identities.length ? new RegExp(identities.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const pathCharacter = /[\p{L}\p{N}_./\\%~-]/u;
  function visit(node: MarkdownNode) {
    if (node.type === "link" || node.type === "definition") {
      const artifact = artifactForPath(node.url ?? "", artifacts);
      if (artifact) node.url = artifactLink(artifact);
      return;
    }
    if (["code", "inlineCode", "image", "imageReference", "linkReference", "html"].includes(node.type)) return;
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !expression) { visit(child); return [child]; }
      const value = child.value ?? "";
      const parts: MarkdownNode[] = [];
      let end = 0;
      for (const match of value.matchAll(expression)) {
        const start = match.index!;
        const next = start + match[0].length;
        // A filename inside a different path or a longer filename is not this file.
        if ((start > 0 && pathCharacter.test(value[start - 1]!)) || (next < value.length && /[\p{L}\p{N}_/\\%~-]/u.test(value[next]!))) continue;
        if (value[next] === "." && next + 1 < value.length && pathCharacter.test(value[next + 1]!)) continue;
        const artifact = artifactForPath(match[0], artifacts);
        if (!artifact) continue;
        if (start > end) parts.push({ type: "text", value: value.slice(end, start) });
        parts.push({ type: "link", url: artifactLink(artifact), children: [{ type: "text", value: match[0] }] });
        end = next;
      }
      if (!parts.length) return [child];
      if (end < value.length) parts.push({ type: "text", value: value.slice(end) });
      return parts;
    });
  }
  return visit;
}
