# BLUEPRINT — Loom（个人 agent 思考工作台）

> 开发总地图。产品定位、架构、关键决策、分期路线都在这。视觉见 [DESIGN.md](DESIGN.md)。
> 这是长期个人项目，目标是**打磨 agent 工程深度**，并沉淀可复用的东西。

## 一句话定位
**一个属于你自己的思考工作台**：日常和 AI 对话是入口，research/学习时把对话铺开成无限画布，同时它还是本地干活 agent 的「指挥塔」。

**北极星**：一个「严肃的思考工具」——冷静、专业、值得信任、重精度。

## 产品结构：三面 + 一底座 + 能力层

**面 ① 对话**（日常入口）— 干净的聊天，`codex app` 那种克制界面。**「聊天 = 只有一个节点的画布」**，不做两套。

**面 ② 无限画布 · 分支对话**（主打，差异化核心）
- React Flow 节点图；每个节点 = 一个多轮对话线程（「索引卡片」）。
- 关键动作：在回复里**划选片段 → 岔出新子节点 → 自动连线回出处**。
- 一张画布 = 一个可命名保存的「研究工作区」。

**面 ③ 本地 Agent 观察哨**（指挥塔）
- **被动观察**本地 Codex / Claude Code 的状态（工作/等待/完成）并通知你，不抢占你的终端用法。

**能力层**（让它真是「agent」，纳入规划、P3 落地）：工具/MCP、跨会话长期记忆、可选主动/定时任务。

**底座 · Electron 主进程**（重活都在这）：模型网关、agent loop、事件总线、SQLite、通知中心。

## 关键产品决策（已定）
| 决策 | 选择 | 理由 |
|---|---|---|
| 分支上下文语义 | **片段 + 可手动挂载祖先** | 默认清爽发散；需要连续深挖时一键挂载祖先链 |
| 观察哨定位 | **只被动观察** | 符合「关注正在工作的 agent」；ACP 是启动/托管协议，旁观终端会话要靠 hooks/日志 |
| 能力层 | 纳入规划，P3 做 | 架构现在就留好位置 |
| 画布引擎 | **React Flow**（无头 + 自定义皮肤） | 富 DOM 聊天节点 + 划词选中最搭；tldraw 会与此刚需打架 |
| agent 底子 | **pi-mono**（`pi-ai` + `pi-agent-core`） | 现成的多provider LLM API + agent loop + 工具 + `transformContext`/`convertToLlm` 接缝 |
| UI 栈 | pi 当无头大脑 + React/React Flow 自建界面 | pi-web-ui 是 Lit，与 React Flow 打架；pi 只用纯 TS 的脑 |
| 记忆 | 学 gbrain，**通过 CLI/工具接**（非 MCP） | pi 故意不原生支持 MCP；gbrain 有 CLI，合 pi「CLI+README」哲学 |

## 架构

```
┌──────────────── Renderer (React) ────────────────┐
│ 对话 · 画布(React Flow) · 观察哨 · 设置             │  纯视图，IPC 订阅事件流
│ 组件只用 DESIGN.md 语义 token                       │  macOS vibrancy 半透明侧栏
└───────────────────────┬───────────────────────────┘
                        │ IPC（事件流 / 命令）
┌───────────────────────┴──── Main (Node) ──────────┐
│ pi-agent-core + pi-ai   ← agent 大脑（握 key/跑工具/流式）│
│   └ 自定义 convertToLlm  ← 画布上下文装配 ★              │
│ SQLite: 画布图谱 / 节点 / 消息 / 记忆 / agent 事件        │
│ 事件总线 · 通知中心（去重 / 点击聚焦 / 多 agent 聚合）     │
│ 观察器: ClaudeCode hooks + Codex 日志 tail             │
│ (P3) 记忆: gbrain CLI，或自研 sqlite-vec               │
└─────────────────────────────────────────────────────┘
      ▲hooks 事件            ▲tail *.jsonl
 你终端里的 Claude Code   你终端里的 Codex
```
**安全姿态**：API key、工具执行、文件访问全在主进程；renderer 纯视图。

## ★ 画布上下文引擎（最核心、也最该秀的一点）
pi 的消息流水线：`AgentMessage[] → transformContext() → convertToLlm() → LLM`。
**画布「片段+挂载」逻辑 = 一个自定义 `convertToLlm`**：节点发消息时，从 SQLite 画布图谱取

```
[ (可选)祖先链  if mountAncestors ]   ← root→父 的完整路径
  seed 片段（快照）                    ← 「用户以下面这段为出发点：…」
  本节点历史消息
] → 发给 Claude
```
- 默认 `mountAncestors=false`（只带片段，发散清爽）；一键挂载接上祖先。
- 每节点显示 **token 计数器**（含祖先与否），让上下文成本可见。
- 工程叙事：「在 pi-agent-core 的 context 管线上实现了**空间化/分支式上下文装配**」。
- 附带用得上：pi 的 `steer()`（跑一半插话）、custom message types（引文 chip 作 UI-only 消息，convertToLlm 时过滤）。

## 数据模型
```
Workspace(画布)  : id, name, viewport
Node(节点)       : id, workspaceId, parentId?, pos, title,
                   messages[], mountAncestors, seed{text, srcNodeId, range}(快照)
Edge             : 由 parentId 导出（React Flow 需 nodes+edges）
```
pi 的会话本身就是树（JSONL 带 `parentId`，内置 `/fork /tree /compact`）——画布相当于给这棵树加空间布局，可复用其结构。

## 记忆（P3，学 gbrain）
gbrain = PGLite/Supabase(pgvector) + 向量嵌入 + 语义检索，以 CLI + MCP 暴露。
- 模式照抄：事实/会话摘要 embedding 入本地向量库，按语义召回注入上下文。
- 接法：pi 不原生 MCP → 把 `gbrain search/query` 当 CLI 工具给 agent 调（或自研 sqlite-vec 轻量版）。

## 观察哨（P2，被动）
- **Claude Code**：首次运行帮写全局 hooks（`Notification`/`Stop`/`PreToolUse`）→ 事件进总线。
- **Codex**：`notify` + tail `~/.codex/sessions/**/rollout-*.jsonl` 推断 工作/等待/完成。
- 系统通知：去重、点击聚焦对应会话、多 agent 聚合面板。
- 注意：JSONL schema 半公开、可能随版本变——**防御式解析**。

## 技术栈
Electron · React · React Flow(@xyflow/react) · TypeScript · pi-mono(`@mariozechner/pi-ai` + `pi-agent-core`) · SQLite · Claude API · (P3) gbrain。字体 Geist/Geist Mono/Noto Sans SC（免费）。

## 导航（外层）
主界面收敛为**两面 + 设置**（依据「聊天 = 只有一个节点的画布」）：
- **工作区**（对话/画布合一）：一张画布 = 一个研究会话；画布退化成线性即聊天。
- **观察哨**：本地 agent 状态。
- **设置**：接入（provider/endpoint/key/model，key 安全存储）+ 外观。
持久侧栏在两面/设置间切换；工作区列表在此管理。

## 路线图
- **P0 · 骨架**（已完成）：Electron + React + pi 打通，单节点聊天，套上 DESIGN.md。
- **P1 · App Shell + 持久化基座**（openspec: `app-shell`）：两面侧栏导航 + 工作区管理 + 设置(接入/外观) + 窗口 chrome + SQLite 基座。先立骨架。
- **P2 · 画布引擎**（openspec: `canvas-branching-context`）：React Flow 画布 + 片段分支（含手动挂载）+ **自定义 convertToLlm 上下文引擎**，插进 shell 工作区、用 shell 存储。
- **P3 · 观察哨**：Claude Code hooks + Codex 日志 tail + 事件总线 + 系统通知（被动）。
- **P4 · 能力层**：工具/MCP + 记忆（gbrain CLI）+ 打磨。

## 项目要沉淀的能力
扩展真实 agent runtime 的上下文管线（分支上下文）· 本地 agent 可观测性（ACP 调研 → hooks/日志）· 向量记忆（gbrain）· MCP/工具 · 干净的 Electron 安全架构 · 自建设计系统（双层 token）。

## 已知风险 / 开放项
- pi 是「启动即托管」非「附着」→ 观察哨走被动是对的。
- pi 不原生 MCP → 记忆走 CLI 工具。
- Claude Code / Codex 的 JSONL schema 可能漂移 → 防御式解析。
- pi 无权限沙箱 → P3 上 bash 类工具要自己加隔离。
- 仓库已迁 `badlogic/pi-mono` → `earendil-works/pi`，本地 remote 待同步。

## 指针
- 视觉系统：[DESIGN.md](DESIGN.md)
- 视觉原型：`prototype/canvas-rf/`（`pnpm dev` → http://localhost:5178/）
- 规划工件：`openspec/`（specs / changes）
