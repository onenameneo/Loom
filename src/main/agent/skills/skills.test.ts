import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSkillCatalog, compileAvailableSkillsIndex, compileSkillContext, createSkillEvent, createSkillReadTool, detectSkillProviderCapabilities, replaySkillEvents } from ".";
import type { Project, Settings } from "../../store/store";
import { DEFAULT_SETTINGS } from "../../store/store";

function skill(root: string, dir: string, body: string) {
  const skillRoot = join(root, dir);
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(join(skillRoot, "SKILL.md"), body, "utf-8");
  return skillRoot;
}

function settings(globalSources: string[] = []): Settings {
  return { ...DEFAULT_SETTINGS, skills: { globalSources } };
}

describe("skill catalog", () => {
  it("discovers valid global skills and reports frontmatter errors", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-skills-"));
    try {
      skill(root, "research", "---\nname: research\ndescription: Research helper\n---\n# Body\n");
      skill(root, "broken", "---\nname: broken\n---\n# Body\n");

      const catalog = buildSkillCatalog({ settings: settings([root]), homeDir: join(root, "home") });

      expect(catalog.activeSkills.map((item) => item.id)).toEqual(["research"]);
      expect(catalog.skills.find((item) => item.id === "broken")?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "missing-description", level: "error" })]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets trusted project skills override global skills", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-skills-"));
    const projectRoot = join(root, "project");
    try {
      skill(root, "global/research", "---\nname: research\ndescription: Global\n---\n");
      skill(projectRoot, ".loom/skills/research", "---\nname: research\ndescription: Project\n---\n");
      const projects: Project[] = [{ id: "p1", name: "P", createdAt: 1, updatedAt: 1, pinned: false, order: 0, sourceRoots: [projectRoot] }];

      const catalog = buildSkillCatalog({ settings: settings([join(root, "global")]), projects, projectId: "p1", homeDir: join(root, "home") });

      expect(catalog.activeSkills).toMatchObject([{ id: "research", scope: "project", description: "Project" }]);
      expect(catalog.skills.find((item) => item.scope === "global")?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "overridden-by-project" })]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("skill events and context", () => {
  it("replays root-to-node events with child-local disable", () => {
    const snapshot = {
      id: "research",
      name: "research",
      description: "Research",
      sourceScope: "global" as const,
      sourceId: "global:/skills",
      sourcePath: "/skills/research",
      hash: "abc",
    };
    const enable = createSkillEvent({ eventId: "e1", action: "skill-enabled", skill: snapshot, timestamp: 1 }) as unknown as AgentMessage;
    const disable = createSkillEvent({ eventId: "e2", action: "skill-disabled", skill: snapshot, timestamp: 2 }) as unknown as AgentMessage;

    expect(replaySkillEvents([{ id: "root", messages: [enable] } as any]).skills).toHaveLength(1);
    expect(replaySkillEvents([{ id: "root", messages: [enable] } as any, { id: "child", messages: [disable] } as any]).skills).toHaveLength(0);
  });

  it("compiles skills as system context when supported and user context otherwise", () => {
    const state = replaySkillEvents([
      {
        id: "root",
        messages: [
          createSkillEvent({
            eventId: "e1",
            action: "skill-enabled",
            timestamp: 1,
            skill: {
              id: "research",
              name: "research",
              description: "Research",
              sourceScope: "global",
              sourceId: "global:/skills",
              sourcePath: "/skills/research",
              hash: "abc",
            },
          }) as unknown as AgentMessage,
        ],
      } as any,
    ]);

    expect(compileSkillContext({ state, capabilities: { midConversationSystemMessages: true } }).messages[0]).toMatchObject({ role: "system" });
    expect(compileSkillContext({ state, capabilities: { midConversationSystemMessages: false } }).messages[0]).toMatchObject({ role: "user" });
  });

  it("detects provider support with explicit compatibility override", () => {
    expect(detectSkillProviderCapabilities({ providerId: "anthropic" })).toEqual({ midConversationSystemMessages: false });
    expect(detectSkillProviderCapabilities({ providerId: "anthropic", compatibility: { midConversationSystemMessages: true } })).toEqual({ midConversationSystemMessages: true });
    expect(detectSkillProviderCapabilities({ providerId: "legacy", compatibility: { midConversationSystemMessages: false } })).toEqual({ midConversationSystemMessages: false });
  });

  it("builds a system-prompt index from model-invocable active Skills only", () => {
    const index = compileAvailableSkillsIndex([
      { id: "research", name: "research", description: "Research primary sources", active: true, disableModelInvocation: false },
      { id: "manual-only", name: "manual-only", description: "Manual command", active: true, disableModelInvocation: true },
    ] as any);

    expect(index).toContain('<skill id="research" description="Research primary sources">');
    expect(index).toContain("skill_read");
    expect(index).not.toContain("manual-only");
  });
});

describe("skill_read", () => {
  it("reads references inside the skill root and rejects traversal", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-skill-read-"));
    try {
      const skillRoot = skill(root, "research", "---\nname: research\ndescription: Research\n---\n");
      mkdirSync(join(skillRoot, "references"), { recursive: true });
      writeFileSync(join(skillRoot, "references", "sources.md"), "source notes", "utf-8");
      const catalog = buildSkillCatalog({ settings: settings([root]), homeDir: join(root, "home") });
      const tool = createSkillReadTool(() => catalog.activeSkills);

      await expect(tool.execute({ toolCallId: "t1", args: { skillId: "research", path: "references/sources.md" } })).resolves.toMatchObject({
        content: [{ type: "text", text: "source notes" }],
      });
      await expect(tool.execute({ toolCallId: "t2", args: { skillId: "research", path: "../secret.txt" } })).rejects.toThrow("path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps skill ids out of the read tool schema because the static prompt is the discovery index", () => {
    const root = mkdtempSync(join(tmpdir(), "loom-skill-read-schema-"));
    try {
      skill(root, "mao", "---\nname: mao-zedong-perspective\ndescription: 毛泽东思维框架\n---\n# Body\n");
      const catalog = buildSkillCatalog({ settings: settings([root]), homeDir: join(root, "home") });
      const tool = createSkillReadTool(() => catalog.activeSkills);

      expect(tool.description).not.toContain("mao-zedong-perspective");
      expect(JSON.stringify(tool.parameters)).not.toContain("mao-zedong-perspective");
      expect(tool.description).toContain("<available_skills>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
