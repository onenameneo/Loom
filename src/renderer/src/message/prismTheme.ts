import type { PrismTheme } from "prism-react-renderer";

// Token 化的 prism 主题：每类 token 的 color 指向 tokens.css 的 --syntax-* 变量，
// 由 [data-theme] 切换 → 语法高亮自动跟随明暗，且零写死色值（遵循 DESIGN.md）。
export const tokenTheme: PrismTheme = {
  plain: { color: "var(--code-text)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--syntax-comment)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--syntax-punctuation)" } },
    { types: ["keyword", "selector", "atrule", "important", "rule"], style: { color: "var(--syntax-keyword)" } },
    { types: ["string", "char", "attr-value", "regex", "url"], style: { color: "var(--syntax-string)" } },
    { types: ["number", "boolean", "constant", "symbol", "inserted"], style: { color: "var(--syntax-number)" } },
    { types: ["function", "class-name", "tag", "builtin"], style: { color: "var(--syntax-function)" } },
    { types: ["variable", "attr-name", "property", "operator", "deleted"], style: { color: "var(--syntax-variable)" } },
  ],
};
