# Loom — 个人 agent 思考工作台

Electron + React + [pi-mono](https://github.com/earendil-works/pi) 的个人向 AI-agent 桌面应用。
对话是入口，research/学习时铺开成无限分支画布，并盯着本地干活的 agent。

- 产品蓝图：[BLUEPRINT.md](BLUEPRINT.md)
- 设计系统：[DESIGN.md](DESIGN.md)
- 画布视觉原型（独立 Vite）：[`prototype/canvas-rf/`](prototype/canvas-rf/)

## 现状：P0 骨架
Electron 壳 + pi 大脑（`pi-agent-core` + `pi-ai`）跑在主进程 + React renderer + 单节点线性聊天接通 Claude，套上设计系统。是「第一个能用的东西」。

## 运行
```bash
cp .env.example .env                  # 填入 ANTHROPIC_API_KEY（主进程 dotenv 自动加载）
pnpm install
pnpm dev                              # 启动 Electron 应用
```
也可直接 `export ANTHROPIC_API_KEY=...` 走 shell 环境变量，不用 .env。
用自定义 endpoint / 代理时设 `ANTHROPIC_BASE_URL=...`（Anthropic 兼容的 messages API）。
- 模型默认 `claude-sonnet-4-5`，可用 `MODEL_ID=... pnpm dev` 覆盖（取值见 pi-ai 的 anthropic 模型表）。
- `pnpm build` 构建，`pnpm typecheck` 严格类型检查。
- 注意：若你的 shell 全局设了 `ELECTRON_RUN_AS_NODE=1`，dev/start 脚本已自动清除它（否则 Electron 会以纯 Node 模式启动主进程而报错）。

## 结构
```
src/
  main/index.ts       ← 主进程：pi Agent + IPC 流式转发（握 API key / 跑工具）
  preload/index.ts    ← contextBridge 安全暴露 window.api
  renderer/           ← React 渲染进程：纯视图，订阅事件流
    src/App.tsx       ← 单节点聊天 UI（流式）
    src/tokens.css    ← 设计系统语义 token（与 DESIGN.md 一致）
```
架构原则：API key / 工具执行 / 文件访问都在主进程，renderer 纯视图。见 BLUEPRINT.md。

## 路线图
P0 骨架（当前）→ P1 无限画布（分支上下文引擎）→ P2 观察哨 → P3 能力层（工具/记忆）。
