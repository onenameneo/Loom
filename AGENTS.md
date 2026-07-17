# Loom — 个人 agent 思考工作台

Electron + React + React Flow 桌面应用；agent 大脑 = pi-mono。三个界面：对话 / 无限分支画布 / 本地 agent 观察哨。北极星：**一个「严肃的思考工具」**。

视觉原型：`prototype/canvas-rf/`（Vite，`pnpm dev` → http://localhost:5178/）。

## Design System
Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
颜色走**双层 token**（primitive → semantic）；组件只引用语义 token（`--bg`/`--surface`/`--accent`…），**绝不写死色值**。参考实现：`prototype/canvas-rf/src/tokens.css`。
Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md.
