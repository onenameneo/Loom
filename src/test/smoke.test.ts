import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs TypeScript tests in the node environment", () => {
    expect(typeof process.versions.node).toBe("string");
  });
});
