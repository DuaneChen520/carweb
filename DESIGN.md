# 设计系统：CarWeb 车机虚拟屏

> 本文档是 CarWeb 视觉语言的**唯一事实源（Single Source of Truth）**，用于约束产品 UI 与指导 Google Stitch 生成新界面。
> 适用对象：车机浏览器内的「手机虚拟屏投屏控制台」——暗色、高密度、以链路健康与多会话编排为核心的驾驶舱界面。
> 设计坐标：密度 **8 / 10（Cockpit Dense）**｜方差 **5 / 10（Offset Asymmetric）**｜动效 **5 / 10（Fluid Restrained）**。

---

## 1. 视觉主题与氛围

这是一块嵌在车机里的**控制驾驶舱（Cockpit）**，不是内容流，也不是营销页。氛围应当：

- **克制而精密**：像一台调校良好的仪器面板——信息密度高，但每一处元素都有明确功能，不做装饰性留白表演。
- **暗色基底、冷峻中性**：以近黑炭灰为画布，靠**层级（明度差）**而非阴影或描边来分隔面板。绝不依赖纯黑背景。
- **单一信号色 + 语义状态色**：交互强调用一种去饱和的「仪表蓝」；链路健康（connected / degraded / reconnecting / disconnected / failed）用克制的语义色表达，不喧哗。
- **非对称但有序**：左右分屏是主结构（非三等分卡片）；侧栏常驻、面板并列；允许偏移留白，但禁止元素互相遮挡。

整体气质：**临床而可靠，像一间有良好照明的控制室**——用户扫一眼就能判断链路状态，而不是被视觉噪音干扰。

---

## 2. 色彩系统与角色

### 2.1 中性基底（暗色驾驶舱）

| 角色 | 名称 | Hex | 用途 |
|---|---|---|---|
| 画布底 | **Cockpit Black** | `#0B0D10` | 全局背景，最底层表面（非纯黑） |
| 抬升面板 | **Panel Surface** | `#14171C` | 分屏 Pane、浮窗、对话框填充 |
| 凹陷面 | **Sunken Well** | `#0F1216` | 输入框、内嵌区、状态指示的底槽 |
| 主文本 | **Instrument Ink** | `#E7EAEE` | 标题、关键数值、主操作文本（非纯白） |
| 次文本 | **Muted Steel** | `#8A9099` | 描述、元数据、设备名、时间戳 |
| 结构描边 | **Whisper Border** | `rgba(255,255,255,0.08)` | 1px 面板分隔线、Pane 边界 |

> 全程统一冷灰基调（偏向 Zinc/Slate），**禁止暖灰与冷灰在同一界面内混用**。

### 2.2 单一品牌强调色（Accent）

| 名称 | Hex | 用途 |
|---|---|---|
| **Signal Blue** | `#5B8DBF` | 主操作 CTA、激活态、焦点环（focus ring）、当前选中 Pane 的强调边 |

- 饱和度约 **44%**，远低于 80% 上限；**全局仅此一个强调色**。
- 禁止：紫色、霓虹蓝、任何带外发光的强调；禁止渐变填充大标题。

### 2.3 语义状态色（功能性，非装饰性）

链路健康与连接状态是产品核心，需清晰但克制的色彩表达（饱和度均 < 80%）：

| 状态 | 名称 | Hex | 对应链路态 |
|---|---|---|---|
| 正常 | **Link OK** | `#3FA777` | connected |
| 降级 | **Link Warn** | `#D9A441` | degraded / reconnecting |
| 失败 | **Link Fail** | `#D45B5B` | disconnected / failed |
| 空闲 | **Idle Ash** | `#5A6068` | idle / 未连接 |

> 状态色**只用于状态指示**（脉冲点、状态条、边框），不用于品牌或普通按钮。禁止把状态色当成主强调色滥用。

### 2.4 禁用色则

- ❌ 纯黑 `#000000`——一律用 `#0B0D10` / `#0F1216`。
- ❌ AI 紫、`#7C3AED` 类霓虹、外发光阴影。
- ❌ 过饱和强调（饱和度 > 80%）。
- ❌ 暖灰与冷灰并存；❌ 渐变文字标题。

---

## 3. 字体排印规则

### 3.0 字体加载（阿里巴巴普惠体 3.0）

- 默认字体即 **阿里巴巴普惠体 3.0（Alibaba PuHuiTi 3.0）**——一款同时覆盖中文与拉丁字符的开源无衬线，原生提供 **7 个字重**（35 ExtraLight → 95 Black）。这是全站唯一主字族。
- **自托管** 7 个字重文件于 `public/fonts/puhuiti/`，通过 `@font-face` 逐档映射（见下）；字体随构建产物走，不依赖外部 CDN，杜绝断链。
- `@font-face` 模板（文件名按官方发布包对应调整）：

```css
/* 阿里巴巴普惠体 3.0 —— 7 字重 */
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 200; src: url("/fonts/puhuiti/ExtraLight.woff2") format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 300; src: url("/fonts/puhuiti/Light.woff2")     format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 400; src: url("/fonts/puhuiti/Regular.woff2")    format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 500; src: url("/fonts/puhuiti/Medium.woff2")     format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 700; src: url("/fonts/puhuiti/Bold.woff2")       format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 800; src: url("/fonts/puhuiti/Heavy.woff2")      format("woff2"); font-display: swap; }
@font-face { font-family: "PuHuiTi 3.0"; font-weight: 900; src: url("/fonts/puhuiti/Black.woff2")      format("woff2"); font-display: swap; }
```

- 若改用第三方 CDN，必须核验链接有效（本系统禁止失效字体链接）。
- 七档字重务必**全部映射并可被 CSS `font-weight` 命中**，不可只挂 1–2 档而浪费 7 字重能力。

### 3.1 字族

- **默认（中文 + 拉丁）**：`"PuHuiTi 3.0", "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif`
  —— 普惠体本身含拉丁字形，作为唯一主字族；系统中文栈仅作降级回退。**禁用 `Inter`**。
- **等宽（遥测数字 / 时间戳 / scrcpy 链路读数）**：`"Geist Mono", "JetBrains Mono", ui-monospace, monospace`
  —— 普惠体为比例字体，密集数字列对齐仍走等宽；密度 ≥ 7 时所有数字（码率、分辨率、延迟、PID）**必须使用等宽**。

### 3.2 七字重排印层级（有效利用 PuHuiTi 3.0 全字重）

| PuHuiTi 字重 | CSS 字重 | 角色 | 用途 |
|---|---|---|---|
| 35 ExtraLight | 200 | 氛围极细 | 超大号空态数字、引导细描（仅大字号，慎用） |
| 45 Light | 300 | 次级引导 | 空态插画配文、副标题、说明性大标 |
| 55 Regular | 400 | 正文基准 | Body 描述、列表项、帮助文字 |
| 65 Medium | 500 | 元数据 | 设备名、时间戳、状态文本、列表强调项 |
| 75 Bold | 700 | 结构标题 | 面板标题 Heading、按钮 Control、标签 |
| 85 Heavy | 800 | 主标 / 读数 | Display 主标题、关键遥测读数（码率 / 分辨率） |
| 95 Black | 900 | 最高强调 | 告警标题、品牌标、极少数强提醒 |

- **层级靠 7 档字重差 + 颜色建立**，不靠一味放大字号；相邻层级至少跨一档字重以保证可辨。
- 实例映射：Display = 85 Heavy｜Heading = 75 Bold｜Body = 55 Regular｜Meta = 65 Medium｜Control = 75 Bold；超大号氛围数字用 35/45，告警用 95 Black。
- 标题缩放统一用 `clamp()`；正文单行 ≤ **65ch**；正文最小 `1rem`(16px)，`14px` 仅限密集元数据。

### 3.3 禁用

- ❌ `Inter`、泛用系统默认无衬线（在追求质感处）。
- ❌ 衬线字体（`Times New Roman`/`Georgia`/`Garamond`）——**仪表盘 / 软件 UI 一律禁止衬线**。
- ❌ 只用到 2–3 档字重而浪费普惠体 7 字重能力；❌ 纯装饰性超大标题。

---

## 4. 组件样式

### 4.1 按钮（Button）
- **主操作**：Signal Blue 实底填充，圆角 `0.5rem`，无外发光。
- **次操作 / 幽灵**：透明底 + 1px Whisper Border，文本用 Instrument Ink。
- **按压反馈**：`active` 态 `translateY(1px)` 的触感下沉，**不做**霓虹外发光、不做自定义鼠标指针。
- 全局**至多一个主 CTA**；不堆「了解更多」次级链接。

### 4.2 面板 / 分屏（Pane / Panel）
- 圆角 `0.75rem`；填充 Panel Surface `#14171C`；阴影用**染背景色的弥散弱阴影**（非纯黑投影）。
- 仅在「抬升即表达层级」时使用面板；高密度区改用 `border-top` 分隔线或负空间替代卡片。
- 选中 / 激活的 Pane：左缘或上缘 2px Signal Blue 强调边。
- 背景空 Pane（`PaneEmptyState`）：用构图化的插画 + 引导文案，而非孤零零的「无数据」。

### 4.3 输入 / 表单（Input）
- **标签在输入框上方**，错误文案在下方；帮助文字可选。
- 凹陷面 Sunken Well 填充，1px Whisper Border；`focus` 时边框转 Signal Blue，配 2px 焦点环。
- 禁用浮动标签（floating label）。

### 4.4 状态指示（Link-State Indicator）
- 用一颗**脉冲圆点**表达链路态：OK 绿常亮微脉、Warn 琥珀呼吸、Fail 红急促脉。
- 点 + 文本（connected / degraded / failed）并排；高密度下可仅留点 + 色值。
- 这是产品灵魂组件，必须一眼可读。

### 4.5 加载态（Loader）
- **骨架屏（Skeleton）**：严格按照目标布局尺寸生成微光占位，**禁止圆形 spinner**。
- 微光走 `transform`/`opacity` 的 shimmer，不闪背景色。

### 4.6 空态 / 错误态
- 空态：构图化插画 + 「如何填充数据」的引导（如「连接手机后此处显示虚拟屏」）。
- 错误态：内联清晰报错，区分「连接失败」与「链路断开」，给出下一步动作按钮。

---

## 5. 布局原则

- **全屏暗色驾驶舱**：`html,body` `overflow:hidden`，根容器 `min-h-[100dvh]`（**禁止 `h-screen`**，避免 iOS Safari 跳动）。
- **CSS Grid 优先**：分屏用 `grid-template-columns` 而非 flex 百分比 math，禁止 `calc()` 百分比 hack。
- **常驻控制侧栏**：固定宽 `52px`（约 `w-13`），任何状态下都常驻且占位，不被浮层遮挡。
- **分屏主结构**：左右 Pane 平分剩余区；全屏浮层只覆盖 DesktopArea，**不遮侧栏**。
- **无重叠**：每个元素独占清晰空间区，禁止绝对定位的内容堆叠、禁止文字压图。
- **非对称留白**：方差 > 4，禁止居中 Hero；用左对齐 / 分屏 / 偏移留白。
- **禁止三等分卡片行**：不用「3 个等宽卡片横排」的功能展示行；改用 2 栏 Zig-Zag、非对称网格或横向滚动。
- **响应式坍缩（< 768px）**：多列布局一律坍缩为单列；禁止移动端横向滚动；触摸目标最小 `44px`。

---

## 6. 动效与交互

- **弹簧物理（Spring）为默认**：`stiffness: 100, damping: 20`——有重量感、克制；**禁止线性缓动堆砌**。
- **持续微交互**：活动组件（链路脉冲点、实时码率读数）带无限循环态（Pulse / Shimmer / Float）。
- **错落编排（Stagger）**：列表、Pane、浮窗入场用级联延迟瀑布揭示，**禁止瞬间整块挂载**。
- **性能纪律**：只动画 `transform` 与 `opacity`；**绝不**动画 `top/left/width/height`；噪点 / 颗粒滤镜只挂在 `fixed` 伪元素上。
- 动效服务于「状态可读」，不做电影化炫技（驾驶场景需要稳定可预期）。

---

## 7. 反模式（禁止清单 / AI Tells）

以下为硬性禁止，出现即视为低质输出：

1. ❌ 任何 emoji（文档与界面均禁）。
2. ❌ 使用 `Inter` 字体。
3. ❌ 通用衬线字体（仪表盘 / 软件 UI 内绝对禁止衬线）。
4. ❌ 纯黑 `#000000`。
5. ❌ 霓虹 / 外发光阴影、紫蓝氛围光。
6. ❌ 过饱和强调色（饱和度 > 80%）。
7. ❌ 大标题上的渐变文字。
8. ❌ 自定义鼠标指针。
9. ❌ 元素互相重叠 / 文字压图。
10. ❌ 三等分等宽卡片网格。
11. ❌ 通用占位名（"John Doe" / "Acme" / "Nexus"）。
12. ❌ 假整数指标（`99.99%` / `50%`）。
13. ❌ AI 文案套话（"Elevate" / "Seamless" / "Unleash" / "赋能" / "无缝" / "下一代"）。
14. ❌ 填充式 UI 文案（"向下滑动探索" / 滚动箭头 / 跳动chevron）。
15. ❌ 失效的 Unsplash 外链——用 `picsum.photos` 或 SVG 头像 / 内联插画。
16. ❌ 高方差项目的居中 Hero。
17. ❌ `h-screen`（用 `100dvh`）、`calc()` 百分比 hack、flex 百分比算间距。

---

## 8. 给 Google Stitch 的使用说明

- 本文件即 Stitch 的 **Visual Description 来源**：第 2 节提供精确 Hex，第 3–6 节提供自然语言约束，第 7 节是反向黑名单。
- 生成新屏时，先喂入本文件全部内容，再描述具体界面（如「左侧常驻 52px 控制栏 + 右侧左右分屏虚拟屏，顶部一条链路状态脉冲条」）。
- 强调「暗色驾驶舱、密度高、单一仪表蓝强调、状态用语义色」三句话，可稳定收敛到本设计语言。
- 生成后对照第 7 节逐条核验，命中任一条即打回重生成。

---

*版本：v1 ｜ 适用范围：CarWeb 全端 UI（连接层 / 会话层 / 分屏桌面编排层）｜ 事实源：本文件 + `src/` 当前代码。*
