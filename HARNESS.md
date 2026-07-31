# HARNESS — Loom agent 洋葱架构与规划

> pi 大脑之上的**应用运行时层**的设计总图。范围 = 给 pi Agent 装工具/权限/压缩/记忆/steering，把「分支聊天」升级成「真 agent」。
> 不含：renderer 视图、P5 的 ACP 外部 agent 编排（另一条独立轨）。
> 产品全景见 [BLUEPRINT.md](BLUEPRINT.md)，视觉见 [DESIGN.md](DESIGN.md)。

## 0. 一句话

**把 agent 逻辑做成洋葱：纯策略在最里，pi 在最外。** 依赖只能由外向内。
pi 的回调接缝（`convertToLlm`/`beforeToolCall`/`afterToolCall`/`transformContext`）= 外圈回调内圈纯策略的注入点。

## 1. 核心洞察：pi 是「外圈适配器」，不是核心

直觉上 pi 是"大脑核心"。但在洋葱结构里，**pi-agent-core 是一个被驱动的适配器**——它是可替换的 LLM 运行时。
真正的核心（我们要秀的 agent 工程）是**纯策略**：分支上下文怎么装配、权限怎么判、什么时候压缩。这些不该 import 任何 pi / electron / sqlite。

好处：
- **可单测**：核心是纯函数，脱离 Electron 就能测（延续现有 `*.test.ts` 风格）。
- **可替换**：pi 换版本、甚至换成别的 runtime，核心不动。
- **叙事强**：「在 pi 的 context/permission 接缝上，注入了一套 pi-agnostic 的纯策略核心」。

## 2. 洋葱四圈

```
   ┌──────────────────────────────────────────────────────────┐
   │  外部世界：Renderer(React) · index.ts 组装根（不在洋葱里）    │
   │  ┌────────────────────────────────────────────────────┐  │
   │  │ ④ 适配器 Adapters   pi · sqlite · IPC · fs · http · gbrain │
   │  │  ┌──────────────────────────────────────────────┐  │  │
   │  │  │ ③ 端口 Ports（契约·内圈声明/外圈实现）           │  │  │
   │  │  │  ┌────────────────────────────────────────┐  │  │  │
   │  │  │  │ ② 应用编排 Application                    │  │  │  │
   │  │  │  │   session · toolRuntime · compaction · memory │ │
   │  │  │  │   ┌──────────────────────────────────┐  │  │  │  │
   │  │  │  │   │ ① 领域核心 Domain（纯 TS · 零依赖）  │  │  │  │  │
   │  │  │  │   │  graph · context规则 · permission策略 │ │  │  │
   │  │  │  │   │  budget · tool契约 · compaction策略   │ │  │  │
   │  │  │  │   └──────────────────────────────────┘  │  │  │  │
   │  │  │  └────────────────────────────────────────┘  │  │  │
   │  │  └──────────────────────────────────────────────┘  │  │
   │  └────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────────────┘
                 依赖方向：外 →→→ 内，绝不反向
```

| 圈 | 职责 | 允许依赖 | 可单测 |
|---|---|---|---|
| **① 领域核心** | 分支图模型与树运算；上下文装配**规则**（祖先链/seed/本节点顺序）；token 预算规则；权限**决策**（tool+args+已存策略 → 允许/拒绝/询问）；压缩**策略**；工具**契约**（interface，非实现） | 无（纯 TS + typebox schema） | ✅ 纯函数 |
| **② 应用编排** | 一个节点一次 agent 运行的生命周期；工具运行时（注册表 + 执行编排 + 调用①的权限决策）；压缩服务；记忆召回。**只认端口，不认具体设施** | ①、③端口 | ✅ 用假端口 |
| **③ 端口** | 契约 interface：`LlmEnginePort` `StorePort` `EventSinkPort` `ApprovalPort` `ClockPort`/`IdPort` `HttpPort`/`FsPort`/`ShellPort` `MemoryPort`。**由内圈声明、外圈实现** | ①的类型 | — |
| **④ 适配器** | pi 适配器（`new Agent`、`convertToLlm`←①、`subscribe`→EventSink、`getApiKey`）；sqlite store；Electron IPC；工具实现（http/fs/shell）；gbrain CLI | ①②③ + 外部库 | 集成测 |

**依赖倒置的落点**：② 需要"跑一次 LLM"，它只调 `LlmEnginePort`；`④/pi 适配器`实现这个端口，并在实现里把 pi 的 `convertToLlm` 回调转交给 ① 的上下文装配规则。**pi 的接缝 = 洋葱的注入孔。**

## 3. 目标目录落点

```
src/main/
  agent/
    core/                    ← ① 纯 TS，零 pi/electron/sqlite import
      graph.ts               ·  Node/Edge/Seed 模型 + ancestorChain/descendants
      context.ts             ·  装配规则：graph+policy → ContextPlan（有序段）
      budget.ts              ·  token 预算规则
      permission.ts          ·  权限决策纯函数
      compaction.ts          ·  压缩策略（何时压/留哪些）
      tool.ts                ·  ToolContract interface（名/schema/结果形状）
    ports.ts                 ← ③ 所有端口 interface
    hooks/                   ← ② hook substrate：注册表 + 具体 hook（按 concern 分组）
      registry.ts            ·  createHookRegistry，中间件组合语义
      events/                ·  onEvent 观测类 hook（toolLifecycle/usage/turnTimer）
      tools/                 ·  onToolCall/onToolResult 类 hook（permissionGate/resultSanitizer）
      context/               ·  onContextTransform 类 hook（compaction/memoryRecall）
    app/                     ← ② 编排（依赖 core + ports）
      session.ts             ·  单节点 agent 生命周期（对标 pi agent-session.ts）
      toolRuntime.ts         ·  注册表 + 执行 + 调权限决策
      compactionService.ts   ·  压缩编排
      memory.ts              ·  记忆召回（H4）
    adapters/                ← ④ 具体设施
      piEngine.ts            ·  LlmEnginePort ← new Agent / convertToLlm / subscribe
      sqliteStore.ts         ·  StorePort（挪现有 store/）
      ipcEventSink.ts        ·  EventSinkPort ← webContents.send
      approvalDialog.ts      ·  ApprovalPort ← IPC 弹窗（H2）
      piTools.ts             ·  Loom neutral tool → pi AgentTool
      gbrainMemory.ts        ·  MemoryPort ← gbrain CLI（H4）
    tools/                   ← 具体 agent tools catalog：now/ calc/ webfetch/ websearch/ bash/
  canvas.ts                  ← 瘦身：只剩 IPC 编排（把 handler 转给 ② 服务）
  index.ts                   ← 组装根：new 各适配器，注入 ② 服务
```

## 4. pi 接缝 ↔ 内圈策略 映射

| pi 接缝（④ 适配器里） | 转交给（内圈） | 用在哪期 |
|---|---|---|
| `convertToLlm(msgs)` | ① `context.ts` 装配规则 | 现有（H0 抽纯） |
| `beforeToolCall({tool,args})` → `{block,reason}` | ① `permission.ts` 决策 →（需询问时）③ `ApprovalPort` | H2 |
| `afterToolCall({result})` → 覆写 | ② 脱敏/截断策略 | H2 |
| `transformContext(msgs)` | ② `compactionService` + ① `compaction.ts` | H3 |
| `subscribe(event)` | ④ → ③ `EventSinkPort` → renderer | 现有 + H1 工具事件 |
| `state.tools = […]` | ② `toolRuntime` 按名装配 | H1 |
| `steer()/followUp()/thinkingLevel` | ② `session` | H5 |
| pi-ai `isContextOverflow()` | ② 触发压缩 | H3 |
| `CustomAgentMessages`（声明合并） | ① 自定义消息类型（seed chip / compactionSummary / branchSummary） | H1/H3 |

### H3 当前落地状态（context-checkpoint-compaction）

H3 已落成一条可运行的 checkpoint 压缩链路：

- ① `core/messages.ts` 定义 versioned Loom derived messages：`loomContextCheckpoint`、`loomSplitTurnContext`、`loomFrozenBranchSummary`。原始 transcript 保持 append-only，checkpoint 只作为投影材料。
- ① `core/budget.ts` / `core/compaction.ts` 负责 token accounting、final request budget allocation、turn-safe cut planning、checkpoint summary input serialization；工具调用/result 配对和 oversized split-turn 都有纯函数回归测试。
- ② `app/compactionService.ts` 负责计划、summarize、持久化、trace/event 生命周期；只有 summary 成功且 abort guard 通过后才 append checkpoint。
- ② `app/session.ts` 在 completed turn 后做 threshold compaction，在新 prompt 前做 preflight compaction；context overflow 只 retry 一次，第二次 overflow 以 bounded error 结束。
- ④ `adapters/summarizationAdapter.ts` 和 `canvas.ts` 把 production summarizer 接到 registry/runtime model 配置；`node:compact` IPC 暴露手动 compact。
- Renderer conversation timeline 显示默认折叠 checkpoint item；Trace 显示 ordered compaction lifecycle、coverage、budget diagnostics 和 summary usage。

仍需手工验证的不是架构空洞，而是真实 Electron/模型环境里的长会话 smoke：长 mounted-ancestor branch、checkpoint expansion、restart recovery、overflow retry。自动覆盖已包含这些路径的单元/集成回归；真实模型触发仍要在发布前跑一次。

## 4.1 类型分层规范：原子 → 分子 → 材料

Loom 遵循 pi-coding-agent 的类型构造方式，但不把 pi 类型误当成业务模型。每层只解决本层的问题，向外组合，不能反向泄漏：

| 层级 | 所属 | 代表类型 | 规则 |
|---|---|---|---|
| **原子** | `pi-ai` | `Message`、`UserMessage`、`AssistantMessage`、`ToolResultMessage`、内容块、`Usage`、`Model` | provider 可理解的最小协议。任何送进 `convertToLlm` 的值必须是完整 `Message`，不得自造只含 `role/content` 的近似结构。 |
| **分子** | `pi-agent-core` | `AgentMessage`、`AgentTool`、`AgentEvent`、`BeforeToolCallContext`、`AfterToolCallResult` | agent 运行时组合出的协议。工具/事件/转写在此层表达；`AgentMessage` 是原子消息和业务消息的联合。 |
| **材料** | Loom `agent/core` | `CanvasNodeModel`、`Seed`、`LoomUiMessage`、上下文/预算/权限规则 | Loom 的业务语义。自定义转写通过 `CustomAgentMessages` 声明合并注册，并在 `convertToLlm` 明确转换或过滤。 |

落地约束：

- ① `core` 只可 `import type` 引用 pi 类型；不得调用 pi 值、Electron、sqlite 或适配器。
- ② `app` 可使用分子类型编排生命周期，但通过 ③ 端口驱动运行时，不能构造 `Agent` 或 provider。
- ③ `ports` 可以引用稳定的 pi 类型作为跨层数据契约；接口字段表达 Loom 需要的最小能力，不透传 pi 实例。
- ④ `adapters/piEngine.ts` 是 pi 运行时值唯一入口；在此完成 pi 分子和 Loom 中性 Hook 上下文的双向映射。
- `convertToLlm` 是材料降级为原子的唯一出口：保留 `Message`，转换需要送达模型的 Loom 消息，过滤纯 UI 消息；返回安全回退而非抛错。
- Hook 覆写必须覆盖 pi 的完整字段语义。当前 `ResultOverride` 与 `AfterToolCallResult` 对齐：`content`、`details`、`isError`、`usage`、`terminate`，均按字段替换、无深合并。

## 4.2 Hook 代码规范

`src/main/agent/hooks/` 是 Loom agent runtime hook 的唯一实现目录，采用 Claude Code 式“hook catalog”组织方式。这里的 hook 指 pi agent runtime 的四个接缝：`onToolCall`、`onToolResult`、`onContextTransform`、`onEvent`；不要和工作站里 Claude Code hooks / Codex notify 的外部活动采集混用。

目录约定：

```
src/main/agent/hooks/
  registry.ts              # createHookRegistry；组合语义，不写具体能力
  index.ts                 # 统一导出 hook registry 和默认 hook factories
  events/                  # onEvent 观测类：toolLifecycle / turnTimer / usageTelemetry
  tools/                   # 工具调用链：permissionGate / resultSanitizer
  context/                 # 上下文链：compaction / memoryRecall / branchSummary
```

落地规则：

- `ports.ts` 只放 hook 契约类型：`AgentHook`、`HookDispatcher`、上下文与覆写结果；不放具体 hook 实现。
- `hooks/registry.ts` 只负责组合语义：拒绝优先、结果链式、上下文顺序、事件广播；不得依赖具体能力。
- 具体 hook 必须是小 factory，例如 `createToolLifecycleHook(deps)`、`createTurnTimerHook(deps)`；依赖显式通过参数传入，不从全局抓 store/window。
- `app/session.ts` 只负责创建 registry 和注册 hook：`hookRegistry.use(createXHook(deps))`；不得写 hook 策略、事件归一化、权限判断或计时逻辑。
- `adapters/piEngine.ts` 只安装 pi 接缝并转发给 `HookDispatcher`；新增能力不得继续修改 piEngine。
- 新 hook 按主接缝分类放目录：只观察事件放 `hooks/events/`，拦截/改写工具放 `hooks/tools/`，改上下文放 `hooks/context/`。
- 每个 hook 文件应有同名单测；至少覆盖触发事件、非目标事件 no-op、边界/错误行为。
- `onEvent` hook 是观测面，单个 hook 异常由 registry 隔离；`onToolCall` / `onToolResult` / `onContextTransform` 不应依赖吞异常来表达业务分支。
- 危险能力默认不在工具实现里自判安全，必须通过 `hooks/tools/permissionGate.ts` 这类 hook 统一决策。

## 4.3 Tool 代码规范

`src/main/agent/tools/` 是 agent 可调用工具的 catalog，只放**具体工具实现**，例如 `now/`、`calc/`、`webfetch/`，未来扩展 `websearch/`、`bash/`、`mcp/`。不要把工具平台代码塞进这里。

目录约定：

```
src/main/agent/tools/
  index.ts                 # 工具 catalog 聚合出口：createDefaultReadonlyTools / export concrete factories
  now/
    index.ts               # createNowTool
    index.test.ts          # 可选：复杂工具同目录测；当前也可由 app/tools.test.ts 覆盖
  calc/
    index.ts               # createCalcTool + pure evaluator
  webfetch/
    index.ts               # createWebFetchTool
  websearch/               # H1+：真实 provider 配置后加入
  bash/                    # H2：必须经 permissionGate 才能启用
```

分层边界：

- `core/tool.ts` 放 neutral tool contract：`ReadonlyAgentTool`、`ToolResult`、内容块、截断/错误 helper。
- `app/toolRuntime.ts` 放 registry/runtime：注册、查找、执行编排、重复名校验、错误归一化。
- `hooks/tools/` 放工具权限和结果策略：permission gate、result sanitizer、脱敏/截断策略。危险判断不写在具体工具里。
- `hooks/events/` 放工具观测：tool lifecycle、usage、计时。
- `adapters/piTools.ts` 放唯一 pi 适配：Loom neutral tool → pi `AgentTool`。
- `app/session.ts` 只从 `tools/index.ts` 拿默认工具列表并注册；不得 import 具体工具子目录做临时拼装。

具体工具实现规则：

- 每个工具一个目录，目录名用稳定小写短名；工具名用 provider 友好的 snake_case，例如目录 `webfetch/` 暴露工具名 `web_fetch`。
- 每个工具导出 `createXTool(deps?)` factory，依赖通过参数显式传入；不要从全局读取 store/window/env，除非该工具的 adapter 层显式传入。
- 工具实现只依赖 `core/tool.ts` 的 neutral contract 和必要端口/标准库；不得 import `pi-agent-core`、Electron renderer、IPC、React。
- 参数 schema 必须用结构化 schema（当前 typebox），描述字段用途；不要让模型传任意未声明 blob。
- 输出必须返回 normalized `ToolResult`：`content` 用 text/image block，`details` 放结构化元数据。
- 输出必须有上限：文本长度、响应大小、执行时间、错误详情都要 bounded；截断要在 `details` 标明。
- 只读工具不得产生本地/远程副作用；副作用工具（如 `bash`、写文件、远程 mutation、MCP action）必须默认不可无批准运行，接入 `hooks/tools/permissionGate.ts`。
- 工具失败优先抛错或返回 normalized error，由 runtime/adapter 统一转成 agent 可理解的错误结果；不要把异常漏到主进程顶层。
- 每个新增工具至少有单测覆盖：参数拒绝、安全边界、成功结果、失败/超时/截断路径。
- `web_search` 不得做假搜索；没有真实 provider/config 时不注册。

## 5. 现状 → 目标：canvas.ts 拆解

现在 [canvas.ts](src/main/canvas.ts)（约 557 行）一肩挑 5 件事，H0 按圈拆开：

| canvas.ts 现有片段 | 去向 |
|---|---|
| `ancestorChain` / `descendantsOf` 树运算 | ① `core/graph.ts` |
| `ancestorMessages` / `seedMessage` / `isLlmMessage` 装配 | ① `core/context.ts`（纯），pi 里的 `convertToLlm` 只做转交 |
| `estTokens` / `budget` | ① `core/budget.ts` |
| `buildModel`（pi-ai `getModel`）、`getAgent`（`new Agent`/`subscribe`） | ④ `adapters/piEngine.ts` |
| `persisted` / `toCanvasNode` / `store.*` | ④ `adapters/sqliteStore.ts` + ② 映射 |
| 全部 `ipcMain.handle(...)` | canvas.ts 保留为薄 IPC 绑定，body 转给 ② |
| `SYSTEM_PROMPT` | ① 领域常量 / ② 配置 |

## 6. 分期路线（每期 = 往哪几圈加什么）

| 期 | 目标 | 触及的圈 | 验收 |
|---|---|---|---|
| **H0 · 拆层** | 按洋葱重组 canvas.ts，**零新功能**，测试全绿 | 建①②③④骨架 | 现有对话/分支/画布行为不变；① 有单测 |
| **H1 · 工具运行时** | 注册表 + 只读工具（web_fetch/search/now/calc）+ 节点内工具时间线 | ① tool契约、② toolRuntime、③ HttpPort、④ 工具实现 + pi 事件转发 | 只读工具能跑、能渲染调用/结果；无需批准 |
| **H2 · 权限安全网** | `beforeToolCall` 批准门（一次/会话/永久·持久化）+ 首个副作用工具（受限目录 fs→bash）+ `afterToolCall` 脱敏 | ① permission、③ ApprovalPort/Fs/Shell、④ 批准弹窗 + 钩子接线 | 副作用工具默认拒绝、弹窗放行、策略可记住 |
| **H3 · 上下文引擎 v2** | 摘要式压缩（versioned checkpoint 自定义消息 + overflow retry + completed/preflight/manual 触发）+ usage diagnostics | ① compaction/budget、② compactionService、④ pi/summarizer 适配器 | 已实现自动/手动/overflow 压缩；自动测试全绿；真实 Electron 长会话 smoke 待跑 |
| **H4 · 记忆** | gbrain CLI 包成 `memory_search`/`memory_write` 工具 + 召回注入 | ③ MemoryPort、④ gbrain 适配器、② memory | 跨会话事实可召回 |
| **H5 · Steering & 打磨** | 跑一半插话 / 停机追问 / 推理档位 / 成本计 | ② session、④ IPC、renderer | 长任务可操控 |

**建议顺序**：H0 → H1 → H2 → H3 → H4 → H5。H0 是纯搬家，先立干净落点；H1 只读工具风险最低、解锁"agent"一词、并铺好 H2 的 UI 通路。

## 7. 决策记录 / 开放项

- **[定]** harness 范围 = pi 大脑能力层（H1–H5）；ACP 外部编排另开轨。
- **[定]** 工具从只读安全起步；副作用工具留到 H2 配批准门。
- **[定]** 记忆复用 gbrain CLI（H4），H0–H3 只留 `MemoryPort` 接缝不实现。
- **[定]** pi 定位为 ④ 适配器（依赖倒置），核心保持 pi-agnostic。
- **[开]** ③ 端口的粒度：务实为主——只为「会替换/需 mock」的设施设端口（LLM/Store/Approval/Http/Memory/Clock），不为一切都抽象。
- **[开]** H2 的 fs/bash：抄 `@mariozechner/pi-coding-agent` 的 execute 逻辑（防截断/abort 成熟）但丢弃其 pi-tui 渲染，还是从零写。
- **[参]** 最佳实践对标：pi 官方 `@mariozechner/pi-coding-agent`（`agent-session.ts` 生命周期、`tools/` 工具、`compaction/` 压缩、`CustomAgentMessages` 声明合并）。
