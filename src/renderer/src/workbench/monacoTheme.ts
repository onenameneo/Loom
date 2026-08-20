import type { editor } from "monaco-editor";

const THEME_TOKEN_NAMES = [
  "--code-bg",
  "--code-text",
  "--border",
  "--code-border",
  "--code-selection",
  "--code-selection-inactive",
  "--code-line-highlight",
  "--code-cursor",
  "--code-scrollbar",
  "--code-scrollbar-hover",
  "--code-widget-bg",
  "--syntax-comment",
  "--syntax-keyword",
  "--syntax-string",
  "--syntax-number",
  "--syntax-function",
  "--syntax-punctuation",
  "--syntax-variable",
] as const;

type ThemeToken = (typeof THEME_TOKEN_NAMES)[number];

function tokenValue(name: ThemeToken): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function byteToHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
}

function parseChannel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percentage) ? percentage * 2.55 : null;
  }
  const channel = Number.parseFloat(trimmed);
  return Number.isFinite(channel) ? channel : null;
}

function parseAlpha(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percentage) ? percentage / 100 : null;
  }
  const alpha = Number.parseFloat(trimmed);
  return Number.isFinite(alpha) ? alpha : null;
}

/** Monaco theme colors use hex values; CSS tokens may legitimately be rgba(). */
export function cssColorToMonaco(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) return `#${[...hex].map((part) => part + part).join("")}`;
    return `#${hex}`;
  }
  const match = value.match(/^rgba?\((.*)\)$/);
  if (!match) return null;
  const channels = match[1].replace("/", ",").split(/[\s,]+/).filter(Boolean);
  if (channels.length !== 3 && channels.length !== 4) return null;
  const rgb = channels.slice(0, 3).map(parseChannel);
  if (rgb.some((channel) => channel === null)) return null;
  const alpha = channels.length === 4 ? parseAlpha(channels[3]) : 1;
  if (alpha === null) return null;
  const result = `#${rgb.map((channel) => byteToHex(channel!)).join("")}`;
  return alpha >= 1 ? result : `${result}${byteToHex(alpha * 255)}`;
}

function themeColor(name: ThemeToken): string {
  return cssColorToMonaco(tokenValue(name)) ?? "#00000000";
}

export function createLoomMonacoThemeData(): editor.IStandaloneThemeData {
  const value = themeColor;
  return {
    base: document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: value("--syntax-comment") },
      { token: "keyword", foreground: value("--syntax-keyword") },
      { token: "string", foreground: value("--syntax-string") },
      { token: "number", foreground: value("--syntax-number") },
      { token: "type", foreground: value("--syntax-function") },
      { token: "function", foreground: value("--syntax-function") },
      { token: "delimiter", foreground: value("--syntax-punctuation") },
      { token: "variable", foreground: value("--syntax-variable") },
    ],
    colors: {
      "editor.background": value("--code-bg"),
      "editor.foreground": value("--code-text"),
      "editorLineNumber.foreground": value("--syntax-comment"),
      "editorLineNumber.activeForeground": value("--code-text"),
      "editorGutter.background": value("--code-bg"),
      "editorIndentGuide.background": value("--code-border"),
      "editorIndentGuide.activeBackground": value("--code-border"),
      "editor.selectionBackground": value("--code-selection"),
      "editor.selectionForeground": value("--code-text"),
      "editor.inactiveSelectionBackground": value("--code-selection-inactive"),
      "editor.inactiveSelectionForeground": value("--code-text"),
      "editor.selectionHighlightBackground": value("--code-selection-inactive"),
      "editor.lineHighlightBackground": value("--code-line-highlight"),
      "editor.lineHighlightBorder": value("--code-line-highlight"),
      "editorCursor.foreground": value("--code-cursor"),
      "editorOverviewRuler.selectionForeground": value("--code-selection"),
      "editorOverviewRuler.border": value("--code-border"),
      "editorWidget.background": value("--code-widget-bg"),
      "editorWidget.border": value("--code-border"),
      "scrollbarSlider.background": value("--code-scrollbar"),
      "scrollbarSlider.hoverBackground": value("--code-scrollbar-hover"),
      "scrollbarSlider.activeBackground": value("--code-scrollbar-hover"),
    },
  };
}

export function defineLoomMonacoThemes(monaco: typeof import("monaco-editor")): void {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  monaco.editor.defineTheme(`loom-${currentTheme}`, createLoomMonacoThemeData());
}

export function loomMonacoThemeName(): "loom-light" | "loom-dark" {
  return document.documentElement.dataset.theme === "dark" ? "loom-dark" : "loom-light";
}
