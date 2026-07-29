import { promises as fs } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { Type } from "typebox";
import type { ReadonlyAgentTool } from "../core/tool";
import { limitText, textResult } from "../core/tool";
import type { SkillCatalogItem } from "./types";

const DEFAULT_LIMIT = 20_000;
const MAX_LIMIT = 80_000;

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel));
}

function cleanLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

function isAllowedRelativePath(path: string): boolean {
  const clean = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  return clean === "SKILL.md" || clean.startsWith("references/") || clean.startsWith("assets/");
}

export function createSkillReadTool(getSkills: () => SkillCatalogItem[]): ReadonlyAgentTool<{ skillId: string; path?: string; limit?: number }, unknown> {
  return {
    name: "skill_read",
    label: "Read Skill File",
    description: "Read bounded UTF-8 text from an active Loom skill's SKILL.md, references, or assets directory. Use a skill id from <available_skills>.",
    parameters: Type.Object({
      skillId: Type.String({ description: "An active skill id from <available_skills>." }),
      path: Type.Optional(Type.String({ description: "Relative path: SKILL.md, references/*, or assets/*." })),
      limit: Type.Optional(Type.Number({ description: "Maximum returned characters." })),
    }),
    readOnly: true,
    execute: async ({ args, signal }) => {
      const skill = getSkills().find((item) => item.id === args.skillId && item.active);
      if (!skill) throw new Error("Skill is not active or discovered.");
      const rel = (args.path?.trim() || "SKILL.md").replace(/\\/g, "/");
      if (rel.startsWith("/") || rel.includes("..") || !isAllowedRelativePath(rel)) {
        throw new Error("skill_read path must be SKILL.md, references/*, or assets/* inside the skill root.");
      }
      if (signal?.aborted) throw new Error("Aborted.");
      const root = resolve(skill.rootPath);
      const target = resolve(root, rel);
      if (!isInside(root, target)) throw new Error("Resolved path escapes the skill root.");
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error("Skill path is not a file.");
      const raw = await fs.readFile(target, "utf-8");
      if (signal?.aborted) throw new Error("Aborted.");
      const limited = limitText(raw, cleanLimit(args.limit));
      return textResult(limited.text, {
        skillId: skill.id,
        path: rel,
        hash: skill.hash,
        truncation: limited.truncation,
      });
    },
  };
}
