# Loom — 个人 agent 思考工作台

Electron + React + React Flow 桌面应用；agent 大脑 = pi-mono。三个界面：对话 / 无限分支画布 / 本地 agent 观察哨。北极星：**一个「严肃的思考工具」**。

视觉原型：`prototype/canvas-rf/`（Vite，`pnpm dev` → http://localhost:5178/）。

## Design System
Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
颜色走**双层 token**（primitive → semantic）；组件只引用语义 token（`--bg`/`--surface`/`--accent`…），**绝不写死色值**。参考实现：`prototype/canvas-rf/src/tokens.css`。
Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
