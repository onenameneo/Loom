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
      tools/                 ·  web_fetch/search/now/calc（H1）→ fs/bash（H2）
      gbrainMemory.ts        ·  MemoryPort ← gbrain CLI（H4）
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
| **H3 · 上下文引擎 v2** | 摘要式压缩（`compactionSummary` 自定义消息 + `isContextOverflow` + `agent_end` 触发）+ 真实 usage token | ① compaction/budget、② compactionService、④ pi 适配器 | 超阈值自动压缩、token 计数诚实 |
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
