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
});
