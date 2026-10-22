# CarWeb 编码与工程标准 (Coding Standards)

本文件是 CarWeb 项目的代码与工程实现基准，也是 `/code-review` 技能在 Standards 轴进行自动化与半自动化审查的权威依据。

---

## 一、通用架构原则

1. **深度模块优先 (Deep Modules)**：
   - 优先设计“小接口、深实现”的模块，隐藏复杂性，减少调用方心智负担；
   - 依赖项通过参数显式注入，避免在内部隐式构造副作用；
   - 严格维护单向数据流与清晰的系统 Seam（接缝）。

2. **核心目录修改必须附带测试**：
   - 对 `src/lib/` 与 `src/hooks/scrcpy/` 的任何行为性改动，必须附带相邻的 `*.test.ts` / `*.test.tsx` 单元测试。

---

## 二、UI 与视觉工程标准 (UI & Visual Design Standards)

CarWeb 作为车载/桌面流媒体控制台应用，界面的可用性、抗干扰性与人机工效是第一优先级。所有前端组件与视图开发必须严格遵循以下标准：

### 1. 舱内人机工效与尺寸下限 (In-Cabin Ergonomics)

- **48px 触控绝对下限 (AAOS / ISO 15008 / WCAG AAA)**：
  - 任何具有点击/交互属性的元素（包括按钮、图标按钮、分屏切换开关、重要选项卡），其实际可点击靶区（Touch Target）必须 **$\ge 48\times 48\text{px}$**。
  - 若视觉设计需要呈现更小的图标（如 20px），必须通过内边距（Padding）或外层包裹透明容器补足至最小 $48\text{px}$ 物理触控区。
  - 相邻触控元素之间的外间距（Gap / Margin）不得小于 **$8\text{px}$**，以避免车辆颠簸环境下的并排误触。
- **排版阶梯标准 (Type Scale)**：
  - 全局字体严格统一为自托管的阿里巴巴普惠体 3.0，杜绝外部不可控字体或随机系统字体；
  - 辅助说明与状态标记：最小不低于 $12\text{px}$；
  - 正文、常规输入与次级按钮：$\ge 14\text{px}$；
  - 核心状态指示与卡片主标题：$\ge 16\text{px}$；
  - 关键遥测数据与核心仪表数值：$\ge 20\text{px}$。

### 2. 色彩与表面层级规范 (Palette & Surface Tokens)

- **杜绝硬编码裸色值**：
  - 严禁在业务组件中随意书写任意十六进制色值（如 `text-[#94a3b8]`、`bg-[#1e293b]`）或未经定义的 `rgb(...)`；
  - 必须严格使用 `tailwind.config.js` 扩展的语义设计变量：
    - 强调色：`accent-*` 系列（深邃 Azure，沉稳低饱和）；
    - 表面色：`surface-*` 系列（`surface.base` 主背景、`surface.card` 卡片容器、`surface.elevated` 模态浮层）；
    - 文本色：`text-*` 语义阶梯（`primary`、`secondary`、`muted`）。
- **深色座舱为主，拒绝纯黑纯白**：
  - 核心界面默认以深色座舱（Dark/Cockpit mode）为第一优先级；
  - 主背景与容器背景使用 Slate 冷灰色阶，严禁使用 `#000000` 纯黑作为大面积背景（纯黑会在夜间产生刺眼的高光剪切与反光），严禁使用纯白 `#ffffff` 大面积文本。

### 3. 光影与材质系统 (Cold Shadows & Neumorphism)

- **统一冷调投光**：
  - 阴影统一使用带蓝黑冷调的着色投影（如 `shadow-card`、`shadow-card-hover`、`shadow-float`），取代泛化的无层次黑影；
  - 拟态或按压组件（如 `NeumorphicButton`）的高光与阴影对比度必须经过适配，暗色变体下应适当削弱白高光强度、增强下沉内阴影。

### 4. 交互与防跳变准则 (Interaction & Stability)

- **Pointer 事件与即时触控**：
  - 核心触控组件按压必须优先使用 `onPointerDown` / `onPointerUp` / `onPointerCancel`，消除移动设备及触屏上 `onClick` 的 300ms 合成延迟；
- **禁止布局抖动 (No Layout Shift)**：
  - Hover、Focus、Active 交互反馈仅允许改变 `transform`、`opacity`、`box-shadow` 及 `background-color`，严禁通过改变 `width`、`height`、`padding` 或 `margin` 来表达按压态。
- **微动效时长限制**：
  - 界面转场与微反馈时长必须控制在 $150\text{ms} \sim 220\text{ms}$ 之间，采用平滑贝塞尔曲线（如 `cubic-bezier(0.23, 1, 0.32, 1)`），杜绝拖沓粘滞的动效。
