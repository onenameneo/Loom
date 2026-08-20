// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createLoomMonacoThemeData, cssColorToMonaco } from "./monacoTheme";

describe("Loom Monaco theme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--code-selection");
    document.documentElement.style.removeProperty("--code-text");
  });

  it("converts CSS rgba colors to Monaco's hex-alpha format", () => {
    expect(cssColorToMonaco("rgba(1, 105, 204, 0.1)")).toBe("#0169cc1a");
    expect(cssColorToMonaco("rgb(36, 41, 47)")).toBe("#24292f");
  });

  it("uses a subtle semantic selection color instead of Monaco's fallback color", () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.setProperty("--code-selection", "rgba(1, 105, 204, 0.16)");
    document.documentElement.style.setProperty("--code-text", "#24292f");

    const theme = createLoomMonacoThemeData();

    expect(theme.inherit).toBe(true);
    expect(theme.colors?.["editor.selectionBackground"]).toBe("#0169cc29");
    expect(theme.colors?.["editor.selectionForeground"]).toBe("#24292f");
  });
});
