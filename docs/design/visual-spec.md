# CarWeb 视觉与界面规范手册 (Visual & UI Guidelines)

本手册是 CarWeb 座舱/车载控制台的官方视觉与交互工程指南。旨在为团队开发者与 AI Agent 提供明确的排版、配色、触控尺寸及交互动效基准，保证界面的专业度、质感与高可用性。

---

## 1. 设计哲学与核心原则

- **舱内工效优先 (Ergonomics First)**：界面首要服务于车机环境，确保颠簸与余光操作下的高容错性（触控尺寸 $\ge 48\text{px}$）。
- **沉稳低干扰 (Calm & Low Distraction)**：拒绝大面积刺眼纯白与泛滥的高饱和紫蓝渐变；以深色座舱（Slate 冷灰阶）为主，辅以单一克制的深邃 Azure 强调色。
- **物理按压质感 (Mechanical Tactility)**：关键按钮继承拟态（Neumorphic）微光影，使用 Pointer 事件提供 0 延迟即时下沉反馈。

---

## 2. 色彩语义体系 (Design Tokens)

所有颜色必须映射到 `tailwind.config.js` 的语义 Token 中，严禁在业务组件中直接书写十六进制或裸 `rgb`。

### 2.1 表面层级 (Surfaces)
| Token 类别 | Tailwind 类名 | 实际色值 | 使用场景说明 |
| :--- | :--- | :--- | :--- |
| `surface.base` | `bg-surface-base` | `#0f172a` (Slate 900) | 控制台主背景、全屏投屏背板。杜绝夜间纯黑眩光与高光倒影。 |
| `surface.card` | `bg-surface-card` | `#1e293b` (Slate 800) | 基础内容容器、分屏卡片、侧边栏面板背景。 |
| `surface.elevated`| `bg-surface-elevated`| `#334155` (Slate 700) | 模态对话框（如 PIN 码弹窗、缓存设置）、浮动下拉菜单、高层级卡片。 |
| `surface.hover` | `bg-surface-hover` | `#283548` | 卡片与交互行的 Hover / Active 微反馈表面。 |

### 2.2 文本与内容层级 (Content)
| Token 类别 | Tailwind 类名 | 实际色值 | 使用场景说明 |
| :--- | :--- | :--- | :--- |
| `content.primary` | `text-content-primary` | `#f8fafc` (Slate 50) | 核心指标、主标题、激活状态按钮文本。高对比但非刺眼纯白。 |
| `content.secondary`| `text-content-secondary`| `#94a3b8` (Slate 400) | 默认正文、次要说明、未激活图标。保证 WCAG AA 对比度。 |
| `content.muted` | `text-content-muted` | `#64748b` (Slate 500) | 占位符、微弱辅助提示、不可用状态。 |

### 2.3 品牌与强调色 (Accent)
- **唯一强调色系**：`accent-*`（`#2f6ae6` 为基准 500 阶）。
- **应用准则**：用于核心 Primary CTA 按钮、开关激活态、核心焦点环（Focus Ring）与发光阴影 `shadow-accent-glow`。

### 2.4 反馈与状态 (Feedback)
- `feedback.success` (`#10b981`)：连接成功、正常流传输。
- `feedback.warning` (`#f59e0b`)：弱网重连中、延迟波动。
- `feedback.danger` (`#ef4444`)：会话异常断开、强制终止。
- `feedback.info` (`#0ea5e9`)：一般状态轮询提示。

---

## 3. 字体与排版阶梯 (Typography)

- **字体资产**：全局唯一采用自托管的 **阿里巴巴普惠体 3.0 (Alibaba PuHuiTi 3.0)**，离线可用。
- **字号阶梯规范**：
  - `text-xs` ($12\text{px}$)：仅限辅助时间戳、极小状态角标；
  - `text-sm` ($14\text{px}$)：常规说明、辅助按钮、列表二级文字；
  - `text-base` ($16\text{px}$)：正文基准、普通卡片标题、常规按钮字号；
  - `text-lg` / `text-xl` ($18\text{px} \sim 20\text{px}$)：弹窗主标题、连接状态标题；
  - `text-2xl` 及以上：核心仪表盘数据（如 FPS、码率关键读数）。

---

## 4. 触控与人机工效准则 (In-Cabin Ergonomics)

1. **48px 绝对下限**：
   - 任何可点击区域（Button、Tab、Icon 点击热区）的物理包围盒宽高必须 **$\ge 48\times 48\text{px}$**。
   - 当图标视觉尺寸为 $20\text{px}$ 或 $24\text{px}$ 时，必须使用 `w-12 h-12 flex items-center justify-center` 或 `p-3` 补足触控面积。
2. **防误触间距**：
   - 相邻独立触控目标之间，间距必须保证至少 **$\ge 8\text{px}$**（Tailwind `gap-2` 或 `space-x-2`）。
3. **即时无延迟响应**：
   - 按钮按压状态绑定 `PointerDown` / `PointerUp` 事件，避免 iOS / Android WebKit 模拟 Mouse 事件产生的延时。

---

## 5. 动效与防跳变原则 (Motion & Stability)

1. **严禁按压跳变 (No Layout Shift on Interaction)**：
   - 按钮处于 Hover、Focus 或 Active 按压状态时，**严禁改变** `width`、`height`、`padding` 或 `margin`。
   - 只能通过 `transform: scale(0.96)`、`opacity`、`boxShadow` 或 `background-color` 提供质感反馈。
2. **微动效时长与曲线**：
   - 交互反馈时长保持在 **$150\text{ms} \sim 220\text{ms}$**；
   - 必须使用标准贝塞尔曲线（如 `cubic-bezier(0.23, 1, 0.32, 1)` 或 Tailwind `ease-out`）。
