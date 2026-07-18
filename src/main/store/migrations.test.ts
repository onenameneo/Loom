import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";

describe("database migrations", () => {
  it("upgrades a v1 nodes table to schema v2 with nullable layout columns", () => {
    const db = new Database(":memory:");
    migrate(db);

    const version = Number(db.pragma("user_version", { simple: true }));
    const columns = (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );

    expect(version).toBe(2);
    expect(columns).toEqual(
      expect.arrayContaining(["layout_x", "layout_y", "layout_width", "layout_height"]),
    );
  });
});
