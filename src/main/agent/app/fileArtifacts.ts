import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { FileArtifactOperation, FileArtifactRecord } from "../../../common/fileArtifacts";

const absolutePathPattern = /(?:^|[\s"'`(（【])((?:\/|[A-Za-z]:[\\/])[^\s"'`<>()）】，。；;]+)/g;
const trailingPunctuation = /[.,:;!?，。；！？、）》】]+$/;

export function discoverArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(absolutePathPattern)) {
    const candidate = match[1]?.replace(trailingPunctuation, "");
    if (!candidate || !isAbsolute(candidate) || !existsSync(candidate)) continue;
    try {
      const canonical = realpathSync(resolve(candidate));
      if (statSync(canonical).isFile()) paths.add(canonical);
    } catch {
      // A path mentioned by an assistant is only a candidate; stale paths stay text.
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
