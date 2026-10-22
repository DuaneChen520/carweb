# Spec: CarWeb 专属车载视觉设计规范与工程准则体系

> 状态：**ready-for-agent**
> 标签：`ready-for-agent`

---

## Problem Statement

当前 CarWeb 项目的技术栈为 React 18 + Tailwind CSS v3 + Lucide Icons + Zustand，应用场景为车机与桌面投屏控制台（包含 `VirtualScreen`、`DesktopScreen`、`ControlSidebar`、`NeumorphicButton` 等）。
目前项目缺少一套统一成文的、由工程与 Agent 自动化工具链共同约束的「专属视觉设计规范」。这导致以下问题：
1. **样式与颜色硬编码散落**：部分组件中散落着十六进制颜色（如 `#94a3b8`、`#1e293b`），缺乏统一的语义化 Token 体系。
2. **缺乏车机人机工效硬门禁**：车机/驾驶舱交互对触控靶区（$\ge 48\times 48\text{px}$）与弱光/强光对比度（WCAG AA/AAA、ISO 15008）有硬性安全指标，目前仅依靠个别组件（如 `NeumorphicButton`）零散自觉保障，缺乏全局机制。
3. **AI 生成代码容易滑向通用模板**：后续 Agent 在编写新组件或重构页面时，极易退化回常见的 AI 泛滥风格（刺眼蓝紫渐变、不适合车机的过小鼠标按钮、高信息密度挤压等）。

我们需要一套基于业内公认基准（AAOS 车载规范 + W3C DTCG Token 标准 + shadcn 自主代码权）、贴合 CarWeb 既有质感（阿里巴巴普惠体 3.0 + 沉稳冷蓝 accent + Slate 深色冷调阴影）的自建视觉体系规范，并以 Matt Pocock 体系的标准文件结构沉淀到代码库中。

---

## Solution

1. 遵循 Matt Pocock 技能组的文件规范，在项目根目录与标准文档区沉淀权威的自建视觉规范文件（`CODING_STANDARDS.md` 与 `docs/design/visual-spec.md`），并补充 ADR-0018 记录架构决策。
2. 在 `tailwind.config.js` 中建立语义化设计变量层（Design Tokens），统一深色座舱（Cockpit/Dark Mode）主表面、强调色、层级文本色与冷调阴影。
3. 确立“48px 车机触控底线”与“八态交互防跳变”作为核心工程规范，并将此准则接入现有的 `/code-review` 与 Agent 开发流程中。

---

## User Stories

1. 作为车载控制台操作者，我希望所有可交互控件的触控区域均不小于 $48\times 48\text{px}$，以便在车辆颠簸或余光盲操时不会发生误触。
2. 作为车载控制台操作者，我希望界面以深色座舱主题为主，且深色背景不使用纯黑（#000000），以便在夜间驾驶时不会产生视觉眩光。
3. 作为车载控制台操作者，我希望卡片与浮层使用冷调微弱蓝黑阴影与浅层次边界，以便在复杂光线下依然能清晰辨识信息层级。
4. 作为车载控制台操作者，我希望交互按钮按压时提供零延迟即时反馈（基于 Pointer 事件），并且按钮尺寸不发生布局抖动，以便获得干脆利落的机械拟态手感。
5. 作为前端开发人员，我希望通过 Tailwind 语义类（如 `bg-surface-elevated`、`text-secondary`、`text-accent`）编写组件，以便无需在代码中死记和硬编码十六进制颜色。
6. 作为前端开发人员，我希望项目字体严格限制在阿里巴巴普惠体 3.0，并且字阶遵循固定比例，以便界面排版在离线车机环境中保持纯粹一致。
7. 作为代码审查人员/Agent，我希望在执行 `/code-review` 时能依据代码库已有的标准文件直接审查 UI 违规（如小于 48px 的裸按钮、硬编码颜色），以便在合并前拦截低质量界面代码。
8. 作为系统架构师，我希望视觉设计规范完全由本地仓库自主掌控，不依赖外部不可控的第三方黑盒样式库，以便保持长期可维护性。

---

## Implementation Decisions

### 1. 规范文件结构与存储位置 (遵循 Matt Pocock 体系)

- 在项目根目录创建/维护 `CODING_STANDARDS.md`，新增针对 UI 与视觉设计的标准审查小节（`## UI & Visual Design Standards`），使 Matt 的 `/code-review` 技能能够开箱即用自动读取。
- 在 `docs/design/visual-spec.md` 沉淀详尽的《CarWeb 视觉与界面规范手册》（涵盖尺寸、色彩、光影、字体阶梯、动画缓动曲线）。
- 撰写 `docs/adr/0018-in-cabin-visual-design-system.md`，记录将“AAOS 车载工效 + DTCG 语义 Token”选为核心视觉架构的决策背景与权衡。

### 2. 语义设计变量 (Design Tokens) 扩展

- 在样式配置中将现有的单一 `accent` 色板扩展并规范为语义层级：
  - **Surface（表面）**：`surface.base`（主背景，冷灰暗调）、`surface.card`（容器卡片）、`surface.elevated`（悬浮/模态层）。
  - **Text（文本）**：`text.primary`（高对比主文字）、`text.secondary`（辅助中灰）、`text.muted`（微弱说明文字）。
  - **Accent（强调）**：统一指向现有的克制深邃 Azure 阶梯。
  - **Feedback（反馈状态）**：成功、警示、断开连接等状态色统一下调饱和度，严禁刺眼亮色。
- 严禁在业务组件中直接硬编码 `#hex` 或 `rgb()` 裸值。

### 3. 车载交互与尺寸准则 (AAOS + ISO 15008)

- **48px 绝对下限**：所有 `button`、`icon-button` 或可点击卡片，最小实际点击面积必须达到 $48\times 48\text{px}$（若视觉尺寸较小，必须使用 padding 或扩大 hit-area 容器）。
- **组件间距**：相邻触控元素间距不少于 $8\text{px}$。
- **排版阶梯**：
  - 辅助说明：最低不小于 $12\text{px}$；
  - 正文与常规按钮文本：$\ge 14\text{px}$；
  - 核心状态与卡片标题：$\ge 16\text{px}$；
  - 关键数字与仪表状态：$\ge 20\text{px}$。
- **防跳变动效**：按钮 Hover/Active 状态仅允许改变 `transform`、`opacity`、`box-shadow` 与背景色，严禁改变 `width`、`height`、`padding` 或 `margin`。

---

## Testing Decisions

### 1. 静态与代码审查接线 (Matt `code-review` 衔接)
- 将规范明确列入 `CODING_STANDARDS.md`。每次对前端组件（`src/components/`）进行修改时，运行 `/code-review` 即可自动触发 Standards 轴审查：
  - 检查是否存在非语义的随意颜色硬编码；
  - 检查是否有裸写的点击元素尺寸小于 48px。

### 2. 单元测试与快照保障 (Seams)
- **测试切面**：以组件的外部可访问属性和 DOM 行为为测试切面（例如在 `src/components/__tests__/` 中新增针对触控目标与语义变体的测试）。
- 断言关键公共组件（如 `NeumorphicButton`、通用图标按钮）渲染出的根元素尺寸计算值或者 Tailwind 类满足 $48\text{px}$（`min-w-[48px] min-h-[48px]` 或 `w-12 h-12`）。

---

## Out of Scope

1. 引入任何第三方大型 UI 库组件（如 MUI、AntD、DaisyUI）。
2. 在本次工程中对所有现有业务逻辑组件做全量破坏性重构（本 Spec 侧重于**建立规范准则、语义 Token 配置与样板组件**，既有组件按演进策略逐步对齐）。
3. 构建独立于 Tailwind 的复杂 CSS-in-JS 或 WebComponent 引擎。

---

## Further Notes

- 本 Spec 为后续开发提供坚实准绳。完成本 Spec 的落地后，后续所有涉及 UI 的开发和重构，均可以在同一套设计语言下平滑展开，彻底解决“AI 生成代码风格四不像”的问题。
