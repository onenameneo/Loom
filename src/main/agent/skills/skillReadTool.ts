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

function skillIndex(skills: SkillCatalogItem[]): string {
  const active = skills.filter((skill) => skill.active);
  if (active.length === 0) return "No active skills.";
  return active.map((skill) => `${skill.id} (${skill.name}): ${skill.description}`).join("; ");
}

export function createSkillListTool(getSkills: () => SkillCatalogItem[]): ReadonlyAgentTool<Record<string, never>, { skills: Array<{
  id: string;
  name: string;
  description: string;
  sourceScope: SkillCatalogItem["scope"];
  sourcePath: string;
  hash: string;
  diagnostics: SkillCatalogItem["diagnostics"];
}> }> {
  return {
    name: "skill_list",
    label: "List Skills",
    description: "List active Loom skills available in this node. Use this before skill_read when the user asks what skills are available or asks to choose a skill.",
    parameters: Type.Object({}),
    readOnly: true,
    execute: async () => {
      const skills = getSkills().filter((skill) => skill.active).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        sourceScope: skill.scope,
        sourcePath: skill.rootPath,
        hash: skill.hash,
        diagnostics: skill.diagnostics,
      }));
      const text = skills.length > 0
        ? skills.map((skill) => `- ${skill.id}: ${skill.description} (${skill.sourceScope}, ${skill.hash})`).join("\n")
        : "No active Loom skills are available for this node.";
      return textResult(text, { skills });
    },
  };
}

export function createSkillReadTool(getSkills: () => SkillCatalogItem[]): ReadonlyAgentTool<{ skillId: string; path?: string; limit?: number }, unknown> {
  const availableSkills = skillIndex(getSkills());
  return {
    name: "skill_read",
    label: "Read Skill File",
    description: `Read bounded UTF-8 text from an active Loom skill's SKILL.md, references, or assets directory. Available skill ids: ${availableSkills}`,
    parameters: Type.Object({
      skillId: Type.String({ description: `Catalog skill id. Use one of: ${availableSkills}` }),
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
