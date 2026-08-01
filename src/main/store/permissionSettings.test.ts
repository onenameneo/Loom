import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./jsonStore";
import { SqliteStore } from "./sqliteStore";
import { DEFAULT_SETTINGS } from "./store";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("permission settings persistence", () => {
  it("uses the safe preset when a legacy JSON settings file has no permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-permissions-json-"));
    dirs.push(dir);
    const file = join(dir, "canvas-data.json");
    writeFileSync(file, JSON.stringify({ version: 1, settings: { access: DEFAULT_SETTINGS.access }, projects: [] }), "utf8");

    expect(new JsonStore(file).getSettings().permissions).toEqual(DEFAULT_SETTINGS.permissions);
  });

  it("normalizes malformed JSON permission values and persists a patch", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-permissions-json-invalid-"));
    dirs.push(dir);
    const file = join(dir, "canvas-data.json");
    writeFileSync(file, JSON.stringify({
      settings: { permissions: { sandboxMode: "not-a-mode", commandOutputLimit: -1, writableRoots: ["", 7] } },
      projects: [],
    }), "utf8");
    const store = new JsonStore(file);

    expect(store.getSettings().permissions).toEqual({ ...DEFAULT_SETTINGS.permissions, commandOutputLimit: 1_024 });
    store.patchSettings({ permissions: { sandboxMode: "read-only", writableRoots: ["/repo"] } });

    const reopened = new JsonStore(file);
    expect(reopened.getSettings().permissions).toMatchObject({
      sandboxMode: "read-only",
      approvalPolicy: "on-request",
      writableRoots: ["/repo"],
    });
  });

  it("round-trips permission settings in SQLite", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-permissions-sqlite-"));
    dirs.push(dir);
    const file = join(dir, "loom.sqlite");
    const store = new SqliteStore(file);
    store.patchSettings({
      permissions: {
        sandboxMode: "workspace-write",
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        networkAccess: true,
        writableRoots: ["/repo"],
        commandOutputLimit: 12_345,
      },
    });

    expect(new SqliteStore(file).getSettings().permissions).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      networkAccess: true,
      writableRoots: ["/repo"],
      commandOutputLimit: 12_345,
    });
  });
});
