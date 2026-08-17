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

## 跨会话长期记忆

在设置中启用后，Loom 默认将长期记忆保存在 `~/.loom/memory/`。路径由主进程按 Electron home directory 和 Node 原生 path API 解析，macOS、Windows、Linux 使用同一套逻辑 root；也可以在设置中配置自定义绝对根目录。

目录布局如下：

```text
memory/
  MEMORY.md                 # 由 Markdown 事实文件生成的可读索引
  user/<type>/<id>.md       # 全局用户记忆，可跨 Project 检索
  feedback/<id>.md          # 用户级协作反馈
  reference/<id>.md         # 用户级外部资源指针
  projects/<projectId>/<type>/<id>.md
  candidates/<id>.md        # 待审核候选，只能被批准后成为 active
  archive/<id>-<timestamp>.md
```

每个记忆文件都带 YAML frontmatter（`id`、`type`、`scope`、`status`、`confidence`、描述、来源和时间戳），正文保存事实。Markdown 是唯一事实源；`MEMORY.md` 可以删除后由 Loom 重建，备份时应连同整个 memory 根目录一起备份。

主 Agent 使用以下逻辑 root 调用通用 `read`、`write`、`edit` 工具：`memory:user`、`memory:project`、`memory:candidates`、只读的 `memory:archive`；Project source roots 则是 `project:0`、`project:1` 等。工具内部仍执行 traversal、realpath、symlink、schema 和 scope 校验，不能跨 root 写入。用户临时提供的 Project 外部绝对文件路径，在 `danger-full-access` 下可以直接交给 `read`；明确请求并通过 approval 后，`write`/`edit` 也可以操作该绝对路径。

这里有两个独立边界：`danger-full-access` 会允许文件工具处理用户明确提供的外部绝对路径，但不会取消 MemoryStore 校验，也不会让外部路径获得 memory 生命周期写入权限；现有文件的 `write`/`edit` 还必须使用先前 `read` 返回的 `expectedVersion`，新文件也不会自动创建缺失的父目录。受限模式下外部绝对路径仍会被 Project root 拒绝。shell 能力也不会因为 sandbox 全开放而自动获得 memory root 的生命周期写入权限。

明确的“记住”请求由主 Agent 通过成功的 `write`/`edit` 结果确认；普通对话中的长期事实可以写入 candidate。回合结束的后台 LLM 提取只是补漏，设置中默认关闭，开启后也只能处理新增 transcript 并写入 candidates。关闭它不影响显式记忆、主 Agent 主动记忆、跨项目 user memory 检索或 AutoDream。

长期记忆与会话 transcript 分离，不会改写已有会话记忆。检索失败不会阻塞对话；AutoDream 受时间、会话数量、节流和锁门控，并将被替换内容移入 `archive/`。所有文件访问发生在主进程，renderer 只通过 IPC 访问记忆摘要和管理操作。

## 路线图
P0 骨架（当前）→ P1 无限画布（分支上下文引擎）→ P2 观察哨 → P3 能力层（工具/记忆）。
