import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("composer narrow-column responsive contract", () => {
  it("uses the composer column as the responsive container", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/src/canvas/canvas.css"), "utf8");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("@container composer (max-width: 560px)");
    expect(css).toContain("@container composer (max-width: 450px)");
    expect(css).toMatch(/\.composer-telemetry-item\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    expect(css).toMatch(/\.model-switcher-root\s*\{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/@container composer \(max-width: 450px\)[\s\S]*?\.model-switcher-root\s*\{[\s\S]*?display:\s*none;/);
  });
});
