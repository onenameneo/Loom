import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverArtifactPaths, operationFromArtifactDetails, persistedArtifactRecords } from "./fileArtifacts";

const root = join(process.cwd(), ".tmp-agent-artifact-test");

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("agent artifact extraction", () => {
  it("finds existing absolute files mentioned by an assistant", () => {
    mkdirSync(root, { recursive: true });
    const file = join(root, "hello-world.docx");
    writeFileSync(file, "doc");
    expect(discoverArtifactPaths(`已创建 ${file}。`)).toEqual([file]);
    expect(discoverArtifactPaths(`路径不存在 ${join(root, "missing.pdf")}`)).toEqual([]);
  });

  it("accepts only file-producing operations from tool details", () => {
    expect(operationFromArtifactDetails({ operation: "create" })).toBe("created");
    expect(operationFromArtifactDetails({ operation: "created" })).toBe("created");
    expect(operationFromArtifactDetails({ operation: "exported" })).toBe("exported");
    expect(operationFromArtifactDetails({ operation: "overwrite" })).toBe("updated");
    expect(operationFromArtifactDetails({ operation: "updated" })).toBe("updated");
    expect(operationFromArtifactDetails({ operation: "edit" })).toBe("updated");
    expect(operationFromArtifactDetails({ operation: "edit-all" })).toBe("updated");
    expect(operationFromArtifactDetails({ operation: "edit-one" })).toBe("updated");
    expect(operationFromArtifactDetails({ operation: "read" })).toBeUndefined();
  });

  it("keeps legacy message metadata readable and restores multiple artifact records", () => {
    expect(persistedArtifactRecords(undefined)).toEqual([]);
    expect(persistedArtifactRecords({ usage: { totalTokens: 4 } })).toEqual([]);
    const records = [
      { id: "artifact_12345678", absolutePath: "/tmp/a.txt", name: "a.txt" },
      { id: "artifact_abcdefgh", absolutePath: "/tmp/b.txt", name: "b.txt" },
    ];
    expect(persistedArtifactRecords({ fileArtifacts: records })).toEqual(records);
  });
});
