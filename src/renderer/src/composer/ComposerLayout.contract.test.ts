import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("composer context indicator layout contract", () => {
  it("keeps the context ring right-aligned and directly beside send", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/src/canvas/canvas.css"), "utf8");
    expect(css).toMatch(/\.context-budget-indicator\s*\{[\s\S]*?margin-left:\s*auto;/);
    expect(css).toMatch(/\.round-send\s*\{[\s\S]*?margin-left:\s*0;/);
    expect(css).toContain(".context-budget-indicator::before");
    expect(css).toContain(".context-budget-indicator:hover::before");
    expect(css).toContain("transition:");
  });
});
