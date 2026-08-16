# Loom — 个人 agent 思考会话台

Electron + React + [pi-mono](https://github.com/earendil-works/pi) 的个人向 AI-agent 桌面应用。
对话是入口，一个会话可铺开成无限分支画布，并盯着本地干活的 agent。

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
- 模型默认 `claude-sonnet-4-5`，全局默认模型在应用「设置」中配置（写入 models.json，解析走 resolveSelectedModel）。
- `pnpm build` 构建，`pnpm typecheck` 严格类型检查。
- 注意：若你的 shell 全局设了 `ELECTRON_RUN_AS_NODE=1`，dev/start 脚本已自动清除它（否则 Electron 会以纯 Node 模式启动主进程而报错）。

## Agent 权限

本地命令工具采用 Codex 风格的两层权限模型：`sandboxMode` 控制技术边界，`approvalPolicy` 控制何时询问。默认配置是 `workspace-write + on-request + user reviewer + network disabled`；Bash、Python、Node、git 和包管理器都通过同一个主进程命令端口运行。

当前 macOS 使用系统 `sandbox-exec` 约束进程树的文件和网络访问；其他平台在尚未提供强制沙箱适配器时会对受限模式 fail-closed，只有明确选择 `danger-full-access` 才允许运行不受沙箱约束的命令。命令参数采用 argv，不经过 renderer 或拼接 shell 字符串；输出、环境变量和执行时长均有上限。

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

## 上下文与 compact

Loom 保留完整的原始 transcript，并以 append-only context checkpoint 投影模型上下文。手动 `/compact`、自动 threshold compact 和 context overflow recovery 共用同一套 turn-safe planner 与结构化 summary；summary 使用 `Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Next Steps`、`Critical Context` 栏目。

自动 compact 使用当前节点最终选中的模型配置计算安全输入预算：`contextWindow - reserved output`，再扣除 system prompt、tools/skills、冻结分支、seed、checkpoint 和当前输入，剩余部分才是 node-local recent tail。provider usage 可用时优先采用，否则明确标记为估算值。模型缺少有效上下文窗口元数据时，自动 compact 会返回有界诊断而不会假装请求安全。

原始消息不会因 compact 被删除；session memory、跨 session recall 和长期事实提取暂不属于当前 compact 流程。

## 路线图
P0 骨架（当前）→ P1 无限画布（分支上下文引擎）→ P2 观察哨 → P3 能力层（工具/记忆）。
