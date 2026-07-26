import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectFileTools } from ".";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "loom-project-files-"));
  dirs.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export const value = 1;\n", "utf-8");
  return root;
}

describe("project file tools", () => {
  it("are hidden when no source folders are configured", () => {
    expect(createProjectFileTools([])).toEqual([]);
  });

  it("lists and reads files inside a configured source folder", async () => {
    const root = workspace();
    const tools = createProjectFileTools([root]);
    const list = tools.find((tool) => tool.name === "project_list_files")!;
    const read = tools.find((tool) => tool.name === "project_read_file")!;

    const listed = await list.execute({ toolCallId: "t1", args: { path: "src" } });
    const content = await read.execute({ toolCallId: "t2", args: { path: "src/index.ts" } });

    expect(listed.content[0]).toMatchObject({ type: "text", text: "file index.ts" });
    expect(content.content[0]).toMatchObject({ type: "text", text: "export const value = 1;\n" });
  });

  it("rejects path traversal outside the configured source folder", async () => {
    const root = workspace();
    const read = createProjectFileTools([root]).find((tool) => tool.name === "project_read_file")!;

    await expect(read.execute({ toolCallId: "t1", args: { path: "../outside.txt" } })).rejects.toThrow(
      "outside this Project",
    );
  });
});
