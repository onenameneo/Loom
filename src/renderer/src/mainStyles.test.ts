import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer stylesheet entrypoint", () => {
  it("loads React Flow base styles before the canvas skin", () => {
    const source = readFileSync(resolve(__dirname, "main.tsx"), "utf8");

    expect(source).toContain('import "@xyflow/react/dist/style.css";');
    expect(source.indexOf('import "@xyflow/react/dist/style.css";')).toBeLessThan(
      source.indexOf('import "./canvas/canvas.css";'),
    );
  });

  it("loads semantic tokens before Tailwind utilities and keeps the documented style layers", () => {
    const source = readFileSync(resolve(__dirname, "main.tsx"), "utf8");

    expect(source.indexOf('import "./tokens.css";')).toBeLessThan(
      source.indexOf('import "./tailwind.css";'),
    );
    expect(source).toContain('import "./shell.css";');
    expect(source).toContain('import "./message/message.css";');
    expect(source).toContain('import "./canvas/canvas.css";');
  });
});

describe("Tailwind semantic theme", () => {
  it("maps the Loom semantic token families without literal color values", () => {
    const source = readFileSync(resolve(__dirname, "tailwind.css"), "utf8");

    for (const token of [
      "--color-loom-bg",
      "--color-loom-surface",
      "--color-loom-text",
      "--color-loom-accent",
      "--color-loom-warn",
      "--color-loom-code-bg",
      "--font-loom-ui",
      "--font-loom-mono",
      "--radius-loom-lg",
      "--shadow-loom-float",
      "--spacing-loom-1",
      "--ease-loom",
    ]) {
      expect(source).toContain(token);
    }
    expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });
});
