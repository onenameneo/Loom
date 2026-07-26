import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";

describe("database migrations", () => {
  it("upgrades to schema v3 with node layout columns and approval policies", () => {
    const db = new Database(":memory:");
    migrate(db);

    const version = Number(db.pragma("user_version", { simple: true }));
    const columns = (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    const approvalColumns = (db.prepare("PRAGMA table_info(approval_policies)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    expect(version).toBe(3);
    expect(columns).toEqual(
      expect.arrayContaining(["layout_x", "layout_y", "layout_width", "layout_height"]),
    );
    expect(approvalColumns).toEqual(expect.arrayContaining(["tool_name", "target", "created_at"]));
  });
});
