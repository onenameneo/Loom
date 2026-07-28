import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import type { Project, Settings } from "../../store/store";
import type { SkillCatalog, SkillCatalogItem, SkillDiagnostic, SkillSource } from "./types";

const SKILL_FILE = "SKILL.md";

function uniq(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function defaultGlobalSkillRoot(homeDir = homedir()): string {
  return join(homeDir, ".loom", "skills");
}

export function configuredGlobalSkillSources(settings: Pick<Settings, "skills">, homeDir = homedir()): string[] {
  return uniq([defaultGlobalSkillRoot(homeDir), ...(settings.skills?.globalSources ?? [])]).map(safeRealpath);
}

function parseFrontmatter(text: string): { attrs: Record<string, string | boolean>; body: string; diagnostics: SkillDiagnostic[] } {
  if (!text.startsWith("---\n")) {
    return { attrs: {}, body: text, diagnostics: [{ level: "error", code: "missing-frontmatter", message: "SKILL.md is missing YAML frontmatter." }] };
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return { attrs: {}, body: text, diagnostics: [{ level: "error", code: "unterminated-frontmatter", message: "SKILL.md frontmatter is not closed." }] };
  }
  const raw = text.slice(4, end).split(/\r?\n/);
  const attrs: Record<string, string | boolean> = {};
  const diagnostics: SkillDiagnostic[] = [];
  for (const line of raw) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!match) {
      diagnostics.push({ level: "warn", code: "unsupported-frontmatter", message: `Ignoring unsupported frontmatter line: ${trimmed}` });
      continue;
    }
    const value = match[2].replace(/^['"]|['"]$/g, "");
    attrs[match[1]] = value === "true" ? true : value === "false" ? false : value;
  }
  return { attrs, body: text.slice(end + 4), diagnostics };
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function scanSkillDirs(rootPath: string, diagnostics: SkillDiagnostic[]): string[] {
  if (!existsSync(rootPath)) {
    diagnostics.push({ level: "info", code: "source-missing", message: "Skill source does not exist.", path: rootPath });
    return [];
  }
  let rootStat;
  try {
    rootStat = statSync(rootPath);
  } catch (error) {
    diagnostics.push({ level: "error", code: "source-stat-failed", message: String((error as Error).message ?? error), path: rootPath });
    return [];
  }
  if (!rootStat.isDirectory()) {
    diagnostics.push({ level: "error", code: "source-not-directory", message: "Skill source is not a directory.", path: rootPath });
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    const skillPath = join(dir, SKILL_FILE);
    if (existsSync(skillPath)) {
      out.push(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      walk(join(dir, entry.name));
    }
  };
  walk(rootPath);
  return out;
}

function itemFromDir(source: SkillSource, dir: string): SkillCatalogItem {
  const skillFilePath = join(dir, SKILL_FILE);
  const text = readFileSync(skillFilePath, "utf-8");
  const parsed = parseFrontmatter(text);
  const fallbackName = basename(dir);
  const rawName = typeof parsed.attrs.name === "string" ? parsed.attrs.name.trim() : fallbackName;
  const name = rawName || fallbackName;
  const description = typeof parsed.attrs.description === "string" ? parsed.attrs.description.trim() : "";
  const diagnostics = [...parsed.diagnostics];
  if (!description) {
    diagnostics.push({ level: "error", code: "missing-description", message: "Skill frontmatter description is required.", path: skillFilePath });
  }
  const id = slug(name || fallbackName);
  return {
    id,
    name,
    description,
    disableModelInvocation: parsed.attrs["disable-model-invocation"] === true,
    scope: source.scope,
    sourceId: source.id,
    rootPath: safeRealpath(dir),
    skillFilePath,
    hash: hashText(text),
    trusted: source.trusted,
    active: false,
    diagnostics,
  };
}

export function buildSkillCatalog(input: {
  settings: Pick<Settings, "skills">;
  projects?: Project[];
  projectId?: string;
  homeDir?: string;
}): SkillCatalog {
  const diagnostics: SkillDiagnostic[] = [];
  const globalSources = configuredGlobalSkillSources(input.settings, input.homeDir);
  const currentProject = input.projectId ? input.projects?.find((project) => project.id === input.projectId) : undefined;
  const projectRoots = uniq(currentProject?.sourceRoots ?? []).map((root) => safeRealpath(join(root, ".loom", "skills")));
  const sources: SkillSource[] = [
    ...globalSources.map((rootPath, index) => ({ id: `global:${rootPath}`, scope: "global" as const, rootPath, trusted: true, registered: index > 0 })),
    ...projectRoots.map((rootPath) => ({ id: `project:${currentProject!.id}:${rootPath}`, scope: "project" as const, rootPath, trusted: true, registered: false, projectId: currentProject!.id })),
  ];

  const discovered: SkillCatalogItem[] = [];
  for (const source of sources) {
    if (!source.trusted) continue;
    for (const dir of scanSkillDirs(source.rootPath, diagnostics)) {
      try {
        discovered.push(itemFromDir(source, dir));
      } catch (error) {
        diagnostics.push({ level: "error", code: "skill-read-failed", message: String((error as Error).message ?? error), path: dir });
      }
    }
  }

  const valid = discovered.filter((skill) => !skill.diagnostics.some((d) => d.level === "error"));
  const byId = new Map<string, SkillCatalogItem[]>();
  for (const skill of valid) byId.set(skill.id, [...(byId.get(skill.id) ?? []), skill]);
  const activeIds = new Set<string>();
  for (const [id, items] of byId) {
    const project = items.filter((item) => item.scope === "project").sort((a, b) => a.rootPath.localeCompare(b.rootPath))[0];
    const global = items.filter((item) => item.scope === "global").sort((a, b) => a.rootPath.localeCompare(b.rootPath))[0];
    const active = project ?? global;
    if (!active) continue;
    activeIds.add(`${active.sourceId}:${id}:${active.rootPath}`);
    for (const item of items) {
      if (item === active) continue;
      item.diagnostics.push({
        level: "info",
        code: item.scope === "global" && active.scope === "project" ? "overridden-by-project" : "shadowed-by-source",
        message: `${active.scope} skill '${active.name}' is active for id '${id}'.`,
        path: active.rootPath,
      });
    }
  }

  const skills = discovered.map((skill) => ({
    ...skill,
    active: activeIds.has(`${skill.sourceId}:${skill.id}:${skill.rootPath}`),
  }));
  return { sources, skills, activeSkills: skills.filter((skill) => skill.active), diagnostics };
}

export function skillSnapshot(skill: SkillCatalogItem) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceScope: skill.scope,
    sourceId: skill.sourceId,
    sourcePath: skill.rootPath,
    hash: skill.hash,
  };
}

