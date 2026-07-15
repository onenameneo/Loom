# Design System — Loom（个人 agent 思考工作台）

> 单一真源。任何视觉/UI 决策前先读本文件。组件只引用**语义 token**（见「颜色架构」），
> 不写死色值。参考实现见 `prototype/canvas-rf/src/tokens.css` + `styles.css`。

## 产品语境
- **是什么**：个人向 AI-agent 桌面应用。三个界面共用一套系统——① 对话；② 无限画布（对话可从选中片段岔出、连线成图）；③ 本地 agent 观察哨（盯 Codex/Claude Code 状态）。
- **给谁**：作者本人（研究/学习/日常助手）。设计质量是关键资产。
- **同类**：Linear、OpenAI Codex app、Raycast、Reflect/Tangent、tldraw。
- **形态**：Electron + React + React Flow；agent 大脑 = pi-mono。

## 北极星（每个决定都服务它）
**一个「严肃的思考工具」** — 冷静、专业、值得信任、重精度。差异化不靠颜色喊，靠画布「制图台」语言。

## 美学方向
- **「安静的技术工作室 / 制图台」**：白色为主的纸感表面，**发丝线(hairline)代替阴影**做层级，等宽字体做「仪表遥测」，印刷/制图语言取代 AI 光晕。
- **装饰等级**：极简。**材质**：白为主 + macOS vibrancy 半透明侧栏。
- **两处刻意背离品类惯例**：(1) 画布「思考图」是核心，prompt 输入框不是视觉中心；(2) 没有「AI 光环」——用结构（分支、引用、运行状态）表达智能，不用发光/渐变。

## 颜色架构（核心 · 抽象分层）
两层 token，换主题只动第二层：

**Tier 1 · Primitives（原始色板）** — 主题无关的原始色 `--c-*`（如 `--c-teal`、`--c-slate`），**组件永不直接引用**。
**Tier 2 · Semantic（语义别名）** — 按角色命名（`--bg`/`--surface`/`--text`/`--accent`…），**组件只认这一层**。

规则：
- 组件写 `var(--surface)`，绝不写 `#fff` 或 `var(--c-white)`。
- **调色** = 改一个 primitive，或把某个语义别名指到另一个 primitive。
- **明暗** = 只重写 `[data-theme="dark"]` 下的 Tier-2 映射，其余全不动。切主题 = 根节点 `data-theme` 属性一改。

### 语义 token（值取自参考实现）
| 语义 | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--bg` | `#ffffff` | `#181818` | 工作区/画布底（Codex 深底，永不纯黑） |
| `--surface` | `#ffffff` | `#202020` | 卡片/面板 |
| `--surface-2` | `#f5f5f5` | `#272727` | 输入框/次级面 |
| `--sidebar-glass` | `rgba(255,255,255,.6)` | `rgba(19,21,24,.55)` | 半透明侧栏材质 |
| `--text` / `--muted` / `--faint` | `#141414`/`#6b6b6b`/`#9a9a9a` | `#f4f4f4`/`#a0a0a0`/`#6f6f6f` | 三级文字（中性，参考 Codex） |
| `--border` / `--border-strong` | `rgba(0,0,0,.09/.15)` | `rgba(255,255,255,.10/.16)` | 发丝线 |
| `--accent` | `#0169cc` Codex 蓝 | `#339cff` | **唯一** accent，只在选中/焦点/主操作/活跃分支 |
| `--accent-soft` / `--accent-line` | teal 低透明 | teal 低透明 | 引文底/边线 |
| `--ok` / `--warn` / `--err` | `#1f9d63`/`#c98a1a`/`#d64b45` | `#56c48a`/`#d3a24a`/`#e0685f` | **语义色=状态**（观察哨、工作区点） |
| `--canvas-dot` / `--edge` | 低透明墨 | 低透明白 | 画布点阵/连线 |
| `--shadow-float` | 见 tokens.css | 见 tokens.css | **只**用于悬浮/拖拽 |
| `--code-bg/border/text` | `#f6f7f9`/发丝/`#24292f` | `#1b1b1b`/发丝/`#e6edf3` | 代码块容器 |
| `--inline-code-bg/text` | 蓝低透明 / `#0550ae` | 蓝低透明 / `#a5d6ff` | 行内 code |
| `--syntax-*` | GitHub-light 系 | GitHub-dark 系 | 语法高亮（keyword/string/number/comment/function/punctuation/variable） |

**颜色纪律**：chrome 全程无色；`--accent` 面积极小；彩色只在**语义处**出现（状态点、diff、代码高亮）。代码高亮是**唯一**成片用色处，且限定在代码块内、走独立 `--syntax-*` token（明暗各一套，GitHub 系），不外溢到 chrome。

## 字体
| 角色 | 字体 | 说明 |
|---|---|---|
| UI / 正文 | **Geist**（400/450/500/600） | 严肃开发工具气质，避开被用烂的 Inter |
| 遥测 / 代码 / 计数 | **Geist Mono** | 呼号 `N-04A`、token 计数、model、时间戳 |
| 中文 | **PingFang SC**（mac）/ **Noto Sans SC** | — |
- **CJK 铁律**：中文比拉丁**重一档**（拉丁 400 ↔ 中文 500）、**行高更大**（CJK ~1.7 vs 拉丁 ~1.5）、不加字距、不全大写。
- 全部免费可商用。可选签名感：聊天阅读列用 **iA Writer Quattro**（OFL）。
- **字号**：正文 12.5–13、阅读列 15–16/1.6；元数据 10–11 mono。

## 间距 / 圆角 / 层级
- **间距** 4px 基：`--s1..s6` = 4/8/12/16/24/32。
- **圆角**：`--r-sm 6`（控件）/`--r-md 10`（输入）/`--r-lg 14`（卡片/面板）。友好但不泡泡，无 16px+。
- **层级 = 发丝线优先**：所有面用 `--border`；阴影只在悬浮/拖拽（`--shadow-float`）。暗色画布卡可用内嵌 rim-light 微光代替投影。**选中 = 细 accent 环，绝不发光。**

## 动效
- **两档速度**：状态(hover/focus) 120–160ms；面板/节点 200–260ms；大视图变化(fit-to-node) ≤400ms。
- **曲线**：默认 `cubic-bezier(0.2,0,0,1)`（阻尼、无过冲）；命令面板可留一丝极轻回弹。
- **无弹跳、无缩放爆点、无发光脉冲**。流式：token 追加 + caret；连线流式时 marching-ants 虚线，完成转实线。
- 尊重 `prefers-reduced-motion`（过冲/淡入降级为瞬时）。

## 画布 / 节点视觉语言
- **节点 = 索引卡片**：发丝线边、`--r-lg` 圆角、顶部 Geist Mono 呼号 + token 计数、静止无阴影、悬浮才浮起。
- **选中**：`--accent` 细环 + `--accent-soft` 轻底，不发光。
- **引文种子 = 标本签**：左 2px `--accent` 竖条 + `--accent-soft` 底 + mono「来自 X」标签。
- **连线 = 制图尺寸线**：细贝塞尔，`--edge` 静止、`--accent` 悬浮/选中；标签 mono。
- **背景**：安静点阵（`--canvas-dot`），非星空/地图。

## 材质与明暗策略（易实现）
- **主题切换**：根节点单个 `data-theme="light|dark"`，全部表面读语义 token 自动换。
- **vibrancy 半透明**：macOS 用 Electron `BrowserWindow { vibrancy: 'sidebar', titleBarStyle: 'hiddenInset' }`；Windows 用 `backgroundMaterial: 'mica'`；其他平台降级为实心 `--sidebar-glass`（不透明兜底值）。侧栏/浮层可半透，工作区/画布主面保持实心以保证文字对比度。
- **可调性**：换 accent = 改 `--accent`/`--accent-hover`/`--accent-soft`/`--accent-line` 指向的 primitive；整体调冷暖 = 改中性 primitive。组件零改动。

## 决策记录
| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-07-14 | 建立设计系统 | /design-consultation：竞品研究 + Codex/Claude 双外部声音综合 |
| 2026-07-14 | 弃紫 `#8c7aff`，accent 曾定石墨青绿 `#2f6f68` | 紫落在 Linear/Reflect 薰衣草的 AI 套路正中心，与「严肃思考工具」相悖 |
| 2026-07-14 | accent 由石墨青绿改为**靛青**再定为 **Codex 蓝** `#0169cc`（暗 `#339cff`）；中性去暖调 | 用户参考 OpenAI Codex 配色；干净、专业、与"严肃思考工具"同频 |
| 2026-07-14 | **产品定名 Loom**（织机/线/分支，呼应分支画布） | 用户拍板 |
| 2026-07-14 | 图标统一 lucide-react；组件只用两层 token（改一处原始色即全局换 accent，本次已验证） | 最佳实践、可维护 |
| 2026-07-14 | 白为主 + 半透明侧栏 + 不花里胡哨 | 用户定；北极星=冷静克制 |
| 2026-07-14 | 双层 token（primitive→semantic），组件只认语义层 | 便于调色、易实现明暗、样式集中可维护 |
| 2026-07-14 | 画布引擎 React Flow（无头，自定义皮肤） | 富 DOM 聊天节点 + 划词选中最搭；tldraw 会与此刚需打架 |
| 2026-07-15 | 统一「消息层」：画布节点与 ChatView 共用 `Message` 组件（user 右/assistant 全宽左，compact/comfortable 双密度） | 消除两界面各写一套、对齐不一致；一处改全局 |
| 2026-07-15 | Markdown = react-markdown + remark-gfm（默认转义 HTML）；代码高亮 = prism-react-renderer + **token 化主题**（`--syntax-*`，随明暗切换） | 最佳实践、安全、轻量；高亮走独立 token 不与设计系统打架 |
