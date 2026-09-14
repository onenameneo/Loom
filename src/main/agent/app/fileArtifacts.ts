import { existsSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import type { FileArtifactOperation, FileArtifactRecord } from "../../../common/fileArtifacts";

const absolutePathPattern = /(?:^|[\s"'`(（【])((?:\/|[A-Za-z]:[\\/])[^\s"'`<>()）】，。；;]+)/g;
const trailingPunctuation = /[.,:;!?，。；！？、）》】]+$/;

export function discoverArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  const candidates = [
    ...Array.from(text.matchAll(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|<([^<>\n]+)>/g), (match) => match.slice(1).find(Boolean)!),
    ...Array.from(text.matchAll(/file:\/\/[^\s<>"'`()]+/g), (match) => match[0]),
    ...Array.from(text.matchAll(absolutePathPattern), (match) => match[1]!.replace(trailingPunctuation, "")),
  ];
  for (let candidate of candidates) {
    try {
      if (candidate.startsWith("file://")) candidate = fileURLToPath(candidate);
      if (!isAbsolute(candidate)) continue;
      if (!existsSync(candidate)) candidate = decodeURIComponent(candidate);
      const canonical = realpathSync(resolve(candidate));
      if (statSync(canonical).isFile()) paths.add(canonical);
    } catch {
      // A mentioned path is only a candidate; stale paths stay text.
    }
  }
  return [...paths];
}

export function operationFromArtifactDetails(details: unknown): FileArtifactOperation | undefined {
  if (!details || typeof details !== "object") return undefined;
  const operation = (details as { operation?: unknown }).operation;
  if (operation === "create" || operation === "created") return "created";
  if (operation === "export" || operation === "exported") return "exported";
  if (operation === "overwrite" || operation === "updated" || operation === "edit" || operation === "edit-all" || operation === "edit-one" || operation === "update") return "updated";
  return undefined;
}

export function persistedArtifactRecords(meta: unknown): FileArtifactRecord[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const value = (meta as { fileArtifacts?: unknown }).fileArtifacts;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FileArtifactRecord => (
    Boolean(item) && typeof item === "object" &&
    typeof (item as FileArtifactRecord).id === "string" &&
    typeof (item as FileArtifactRecord).absolutePath === "string"
  ));
}
