# 虚拟屏顶部栏：触控无障碍与布局缺陷排查及优化方案

> 日期：2026-08-04
> 范围：`PaneDropdown` / `FullscreenDropdown` / `PaneSelector`（虚拟屏顶部悬浮控件栏）
> 状态：排查完成，待评审后实施

---

## 1. 结论摘要

顶部栏是 S3「UI 触屏化」阶段的**漏网之鱼**。`docs/plans/2026-08-04-car-head-unit-quality-fix.md` §S3 明确要求触控目标 ≥48px、间距 ≥8px、去 hover-only 交互，但落地提交 `a3ab007` 的改动清单中：

- 已覆盖：`NeumorphicButton.tsx`、`ControlSidebar.tsx`、`VirtualScreen.tsx`、`index.css`、`DesktopShell.tsx`
- **未覆盖**：`PaneDropdown.tsx`、`FullscreenDropdown.tsx`、`PaneSelector.tsx`、`SplitPane.tsx`、`FullscreenOverlay.tsx`

结果是：侧边栏按钮已达 48px，而顶部栏按钮仍停留在重构提交 `3a4cbec` 时的 **20×20px**，可点面积仅为无障碍下限的 **17%**。

同时发现一个 **P0 级确定性布局 bug**：`FullscreenDropdown.tsx:96` 的 `className` 同时包含 `absolute` 与 `relative`，导致右侧按钮组换行错位并与应用名重叠——这正是用户观察到的「重叠、按钮跨行错位」。

共定位 **13 项缺陷**：布局类 4 项、触控无障碍类 6 项、交互健壮性类 3 项。

---

## 2. 排查方法与证据来源

| 手段 | 用途 |
| --- | --- |
| 全量扫描 `src/**/*.tsx`（25 文件 / 4663 行） | 确认顶部栏实现仅存在于 3 个组件，无遗漏 |
| 读取 `dist/assets/index-*.css` 构建产物 | 验证 Tailwind 定位类的层叠优先级（非理论推测） |
| `git log --name-only` 比对 S3 提交范围 | 确认顶部栏未被触控优化覆盖 |
| 对照 `NeumorphicButton.tsx` 的 `BTN=48` / `ICON_SIZE=20` | 确立项目自身的触控基线 |
| 对照 AAOS Design System / Material 无障碍指南 | 确立外部规范基线 |

---

## 3. 缺陷清单

### A 类：布局 bug

#### A-1（P0）`absolute` 与 `relative` 冲突，右侧按钮组跨行错位并重叠

**位置**：`src/components/desktop/FullscreenDropdown.tsx:96`

```tsx
<div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 relative">
```

**根因**：Tailwind 的 position 工具类按固定顺序生成，`.relative` 定义在 `.absolute` 之后。构建产物实测：

```
.static{position:static}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{...}
                                              ↑ index 5976                  ↑ index 6004（后定义，胜出）
```

两者特异性相同，后定义者胜出 → 实际生效的是 `position: relative`。

**后果链**：

1. 该 div 退回正常文档流，紧跟在应用名 div 之后 → **换行到第二行**；
2. `right-3` 对 relative 元素表现为「相对自身左移 12px」，不再贴容器右边缘 → **右侧大片留白**；
3. `-translate-y-1/2` 是 `transform`，**无条件生效**，将按钮行上提自身高度的 50% → **与应用名行重叠**；
4. 顶栏高度由 1 行撑成 2 行，而 `ChevronUp` 收起按钮为 `absolute inset-0 ... justify-center`，垂直居中于两行总高 → **落在两行夹缝**，同时与上下内容重叠。

**影响**：全屏模式下顶部栏视觉错乱，「分屏 / 关闭」按钮位置不可预期。这是必现 bug，非边界条件。

**修复**：删除末尾多余的 `relative`。但更彻底的做法见 §4.2——改用 flex 三段式布局，从根上消除 absolute 叠放。

---

#### A-2（P1）绝对居中的收起按钮在窄 pane 下压住「切换应用」按钮

**位置**：`PaneDropdown.tsx:53-61` 与 `FullscreenDropdown.tsx:77-85`

中间层 `absolute inset-0 flex items-center justify-center` 与左侧内容处于**同一坐标系但互不感知**，靠「容器够宽」隐式保证不碰撞。

几何推算（pane 宽 W，顶栏容器宽 W−16，内层 `px-3`）：

- 左侧内容右边界 = 12 + 应用名 `max-w-[120px]` + `gap-1` 4px + 切换按钮 20px = **156px**
- 收起按钮左边界 = (W−16)/2 − 10

重叠条件：`(W−16)/2 − 10 < 156` → **W < 348px**

分屏时单 pane 宽 ≈ (视口宽 − 64 侧边栏 − 12 间隙) / 2，代入得：**视口宽 < 772px 即触发重叠**。800×480 类车机屏、竖屏车机或缩小的浏览器窗口都会落入该区间。

---

#### A-3（P2）应用名宽度硬编码，不随容器响应

`max-w-[120px]`（pane）/ `max-w-[160px]`（全屏）为固定值，未使用 `flex-1 min-w-0` 弹性收缩，也无任何响应式断点。宽屏浪费空间，窄屏过早截断。且 `useAppDisplayName` 解析失败时兜底为完整包名（如 `com.autonavi.minimap`），截断后信息量为零。

---

#### A-4（P2）`z-20` 与 `AppTransitionPlaceholder` 同层

`SplitPane.tsx` / `FullscreenOverlay.tsx` 中过渡占位层与顶部栏均为 `z-20`，仅靠 DOM 顺序决定压盖关系。语义上顶部栏应始终高于过渡层，当前是脆弱的隐式约定。

---

### B 类：触控无障碍缺陷

#### B-1（P0）触控目标 20×20px，仅为无障碍下限的 17%

| 元素 | 类名 | 实际尺寸 | 对 48px 下限 | 对 AAOS 76px |
| --- | --- | --- | --- | --- |
| 切换 / 全屏 / 分屏 / 关闭 | `p-1` + icon 12 | **20×20** | 17% 面积 | 6.9% 面积 |
| 展开态收起箭头 | `p-1` + icon 14 | **22×22** | 21% | 8.4% |
| 折叠态触发器 | `p-1.5` + icon 14 | **26×26** | 29% | 11.7% |
| 参照：侧边栏按钮 | `BTN=48` | 48×48 | 100% | 40% |

Material 无障碍要求实测目标 7–10mm；20px 在典型车机屏（约 150dpi）上约 3.4mm，行驶中几乎不可能准确命中。

#### B-2（P0）按钮间距 `gap-1` = 4px，低于 Material 建议的 8px

「全屏 / 关闭」与「分屏 / 关闭」两两相邻仅 4px。而**关闭 = force-stop + 销毁 session + 销毁虚拟屏，不可逆且无二次确认**。误触代价与命中难度严重不匹配。

#### B-3（P1）交互反馈完全依赖 `hover:`，触屏上不存在

所有按钮的状态反馈只有 `hover:text-white hover:bg-white/10`（关闭键 `hover:text-red-400`）。触屏无 hover 态，用户按下时**得不到任何颜色/背景反馈**，仅靠 `index.css` 全局兜底的 `button:active { transform: scale(0.96) }` 提供轻微缩放。缺少 `active:` 变体。

#### B-4（P1）`title` 属性作为唯一说明，触屏上不可用

展开态 5 个按钮全部只有 `title`，无 `aria-label`：

```tsx
<button ... title="切换应用">   // 无 aria-label
<button ... title="全屏">
<button ... title="关闭">
<button ... title="分屏">
<button ... title="收起">
```

`title` 依赖鼠标悬停呈现，触屏设备上永不显示；图标又是纯线框无文字标签 → 首次使用者无法判断按钮语义。仅折叠态触发器有 `aria-label`（`PaneDropdown.tsx:38`），存在明显不一致。

#### B-5（P1）折叠态触发器对比度过低

`bg-slate-900/30` + `text-slate-400`：30% 不透明度的深色底叠在任意应用画面上，配合中灰图标，在浅色应用界面（如地图白天模式）或强光直射下几乎不可见。且无 `aria-expanded` 表达折叠状态。

#### B-6（P1）`PaneSelector` 子菜单未触控化

| 元素 | 类名 | 高度 |
| --- | --- | --- |
| pane 选项 | `px-3 py-2` + 两行文本 | ≈46px（临界） |
| 「取消」 | `px-3 py-1.5` + `text-sm` | **≈30px** |
| 覆盖确认「取消 / 确认覆盖」 | `px-3 py-1.5` | **≈30px** |

同样全部依赖 `hover:bg-slate-100`，无 `active:` 反馈。「确认覆盖」是破坏性操作却与「取消」同尺寸并排。

---

### C 类：交互健壮性

#### C-1（P1）外部点击关闭监听 `mousedown`，触屏语义错误

`FullscreenDropdown.tsx:45`：

```tsx
document.addEventListener('mousedown', handleClickOutside);
```

触屏上 `mousedown` 是浏览器在 `touchend` 之后派发的**合成事件**，存在延迟；若用户以滑动/取消手势结束，则完全不派发，子菜单无法关闭。应改用 `pointerdown`。

> 注：`c8d56b9`「修复侧栏触发按钮与外部点击监听器的冲突」已在侧边栏处理过同类问题，此处未同步。

#### C-2（P2）折叠态与展开态行为不一致

`PaneDropdown` 的切换/全屏/关闭均先 `setCollapsed(true)` 再执行动作；`FullscreenDropdown` 的「分屏」按钮不收起，「关闭」收起。行为不统一。

#### C-3（P2）缺少收起的兜底路径

顶部栏展开后只能通过 22×22px 的收起箭头关闭，没有「点击画面空白处收起」「N 秒无操作自动收起」「Esc 键收起」等兜底。在最难命中的按钮上承载了唯一的退出路径。

---

## 4. 优化方案

### 4.1 设计原则

1. **视觉尺寸与热区解耦**——顶部栏是悬浮层，不能为满足 48px 而把视觉做得笨重。采用「小视觉 + `::after` 扩展热区」，热区 ≥48px，视觉保持轻盈。
2. **消除 absolute 叠放**——改用 flex 三段式，让浏览器负责避让，从根上杜绝 A-1 / A-2 类重叠。
3. **消除重复**——`PaneDropdown` 与 `FullscreenDropdown` 结构 90% 重合，抽出共享原语。
4. **对齐项目既有基线**——复用 `NeumorphicButton` 的 48px / icon 20px 常量语义，与侧边栏一致。

### 4.2 新增原语：`TopBarButton`

新建 `src/components/desktop/TopBarButton.tsx`：

```tsx
/**
 * TopBarButton —— 顶部悬浮栏专用触控按钮。
 *
 * S4-P0：视觉尺寸与触控热区解耦——
 * 视觉 32×32（不压迫悬浮栏），热区经 ::after 扩展至 48×48（Material 无障碍下限）。
 * 触屏无 hover，故反馈以 active: 为主、hover: 为辅。
 */
import type { LucideIcon } from 'lucide-react';

interface TopBarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  expanded?: boolean;
}

export function TopBarButton({
  icon: Icon, label, onClick, variant = 'default', expanded,
}: TopBarButtonProps) {
  const tone = variant === 'danger'
    ? 'text-slate-300 active:text-red-300 active:bg-red-500/25 hover:text-red-400'
    : 'text-slate-300 active:text-white active:bg-white/20 hover:text-white';

  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(expanded !== undefined ? { 'aria-expanded': expanded } : {})}
      className={[
        'relative flex items-center justify-center w-8 h-8 rounded-lg',
        'transition-colors touch-manipulation shrink-0',
        // 热区扩展至 48×48，不影响视觉尺寸与布局
        "after:content-[''] after:absolute after:left-1/2 after:top-1/2",
        'after:-translate-x-1/2 after:-translate-y-1/2 after:w-12 after:h-12',
        tone,
      ].join(' ')}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
```

要点：
- 视觉 32×32、图标 18px，热区 48×48（B-1 解决）；
- `aria-label` 必填，图标 `aria-hidden`（B-4 解决）；
- `active:` 变体提供触屏按压反馈（B-3 解决）；
- `variant="danger"` 让关闭键在静止态即有区分度，不依赖 hover。

### 4.3 顶部栏改为 flex 三段式

以 `FullscreenDropdown` 为例，展开态容器改为：

```tsx
<div className="absolute top-2 left-2 right-2 z-30 pointer-events-none animate-fade-in">
  <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md
                  rounded-xl px-2 py-1.5 pointer-events-auto shadow-lg shadow-black/30">

    {/* 左：应用名，弹性收缩 */}
    <div className="flex-1 min-w-0 flex items-center gap-2 pl-1">
      <span className="text-white/90 text-sm truncate">{displayName}</span>
    </div>

    {/* 中：收起 —— 参与 flex 布局，不再 absolute 居中 */}
    <TopBarButton icon={ChevronUp} label="收起控件栏" onClick={toggle} expanded />

    {/* 右：功能区，与中段留 8px 间距 */}
    <div className="flex items-center gap-2 shrink-0">
      <TopBarButton icon={SplitSquareHorizontal} label="分屏" onClick={...} />
      <TopBarButton icon={X} label="关闭应用" variant="danger" onClick={...} />
    </div>
  </div>
</div>
```

变化点：
- 删除 `absolute inset-0` 居中层与 `absolute right-3` 右侧层 → **A-1 / A-2 同时消失**；
- `gap-2` = 8px 满足 Material 间距（B-2 解决）；
- `flex-1 min-w-0 truncate` 让应用名自适应收缩（A-3 解决）；
- `z-30` 明确高于 `AppTransitionPlaceholder` 的 `z-20`（A-4 解决）；
- 背景 `slate-900/80` 提升对比度，字号 `text-xs` → `text-sm`。

> 收起按钮不再严格居中，而是「靠右分组的左侧」。若产品上必须保持视觉居中，可在左段加等宽占位 `<div className="w-8 shrink-0" />` 配合 `justify-between`，仍不需要 absolute。

### 4.4 折叠态触发器

```tsx
<div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
  <button
    onClick={toggle}
    aria-label="展开控件栏"
    aria-expanded={false}
    className="pointer-events-auto relative flex items-center justify-center
               w-11 h-7 rounded-full bg-slate-900/70 text-slate-200
               backdrop-blur-sm transition-colors touch-manipulation
               active:bg-white/25 active:text-white
               after:content-[''] after:absolute after:left-1/2 after:top-1/2
               after:-translate-x-1/2 after:-translate-y-1/2 after:w-14 after:h-12
               animate-fade-in"
  >
    <ChevronDown size={18} aria-hidden />
  </button>
</div>
```

- 视觉为 44×28 胶囊「把手」，语义比孤立箭头更清晰；
- 热区 56×48（B-1 解决）；
- 底色 `slate-900/70` + 图标 `slate-200`，对比度显著提升（B-5 解决）；
- 补 `aria-expanded`。

### 4.5 破坏性操作防误触

关闭按钮承载不可逆的 force-stop + 销毁虚拟屏，建议二选一：

- **方案 A（推荐，轻量）**：二次点击确认。首次点击切换为「确认关闭」文字按钮并启动 3 秒回退计时，期间再次点击才执行。无额外浮层，触控友好。
- **方案 B**：复用 `PaneSelector` 的确认样式弹出确认气泡。一致性好，但多一层浮层，窄 pane 下有溢出风险。

同时在布局上让关闭键与其相邻按钮的间距加大到 `gap-3`（12px），或用 `ml-1 pl-1 border-l border-white/10` 做视觉分隔。

### 4.6 `PaneSelector` 触控化

```tsx
// pane 选项：min-h 48 + active 反馈
className="w-full flex items-center gap-2 px-3 min-h-[48px] rounded-lg
           text-left transition-colors touch-manipulation
           hover:bg-slate-100 active:bg-slate-200"

// 取消 / 确认覆盖：min-h 48 + 破坏性操作加宽
className="min-h-[48px] px-5 text-sm rounded-lg transition-colors
           touch-manipulation active:bg-slate-200"
```

并为子菜单容器加边界保护：`max-w-[min(280px,calc(100vw-2rem))]` + `max-h-[60vh] overflow-y-auto`。

### 4.7 交互健壮性

```tsx
// C-1：mousedown → pointerdown
document.addEventListener('pointerdown', handleClickOutside);
return () => document.removeEventListener('pointerdown', handleClickOutside);
```

```tsx
// C-3：Esc 收起 + 8 秒无操作自动收起
useEffect(() => {
  if (collapsed) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollapsed(true); };
  const timer = window.setTimeout(() => setCollapsed(true), 8000);
  window.addEventListener('keydown', onKey);
  return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer); };
}, [collapsed]);
```

C-2：统一约定「任何会改变布局或会话状态的动作，执行前一律 `setCollapsed(true)`」，`FullscreenDropdown` 的分屏按钮补齐。

### 4.8 消除重复（可选，建议同期做）

`PaneDropdown` 与 `FullscreenDropdown` 除「左段是否带切换按钮」「右段是全屏还是分屏」外完全一致。建议抽出 `TopBarShell`：

```tsx
interface TopBarShellProps {
  displayName: string;
  packageName: string;
  collapsed: boolean;
  onToggle: () => void;
  actions: ReactNode;      // 右段按钮组
  leadingAction?: ReactNode; // 左段附加按钮（pane 的「切换」）
}
```

两个组件退化为 30 行左右的配置层，未来触控规范调整只需改一处。

---

## 5. 实施计划

| 阶段 | 内容 | 涉及文件 | 验收 |
| --- | --- | --- | --- |
| S4-1（P0） | A-1 定位类冲突、B-1 触控目标、B-2 间距 | 新增 `TopBarButton.tsx`；改 `FullscreenDropdown.tsx`、`PaneDropdown.tsx` | `npm run test/check/lint` 全通过；实机全屏顶栏单行无重叠 |
| S4-2（P1） | A-2 flex 三段式、B-3 active 反馈、B-4 aria、B-5 对比度、C-1 pointerdown | 同上 + `PaneSelector.tsx` | 800×480 与 1920×720 两档窗口宽度下均无重叠；触屏按压有可见反馈 |
| S4-3（P1） | B-6 子菜单触控化、4.5 防误触 | `PaneSelector.tsx`、`FullscreenDropdown.tsx` | 全量热区扫描 ≥48×48px |
| S4-4（P2） | A-3 响应式、A-4 层级、C-2 一致性、C-3 兜底收起、4.8 去重 | 新增 `TopBarShell.tsx` | 顶栏代码行数下降，行为一致 |

> 依 `AGENTS.md`：`src/lib/` 与 `src/hooks/scrcpy/` 属核心热点区需配套测试；本次改动集中在 `src/components/desktop/`，不触及该边界，但建议为 `TopBarButton` 补一条渲染 + `aria-label` 的快照测试。

## 6. 验收标准

1. 全屏 / 分屏顶部栏在展开态均为**单行**，任意视口宽度（≥640px）下元素零重叠；
2. 顶部栏与子菜单内**所有**可交互元素热区 ≥48×48px，相邻间距 ≥8px；
3. 每个按钮均有 `aria-label`；折叠触发器有 `aria-expanded`；
4. 触屏按下时有可见的颜色/背景反馈，不依赖 hover；
5. 关闭操作有二次确认或明显的视觉隔离；
6. 子菜单在触屏上点击外部可靠关闭（`pointerdown`）；
7. `npm run test` / `npm run check` / `npm run lint` 三命令全绿。

## 7. 风险与权衡

| 风险 | 说明与缓解 |
| --- | --- |
| 顶栏高度增加遮挡画面 | 展开态由 ~29px 增至 ~56px。缓解：顶栏为悬浮层不压缩画面尺寸；折叠态仅 28px 高把手；补充自动收起（4.7）。 |
| 收起按钮不再绝对居中 | flex 方案下视觉重心右移。若不可接受，用等宽占位块实现居中，仍避免 absolute。 |
| 二次确认增加操作步数 | 仅作用于不可逆的关闭操作；切换/全屏/分屏保持一步直达。 |
| 热区 `::after` 重叠 | 相邻按钮 `gap-2`=8px、热区各外扩 8px，理论上边缘相接但不重叠；若改小间距需同步收窄热区。 |

## 8. 参考

- Android Automotive OS Design System「Sizing」：触控目标 ≥76×76dp、间距 ≥24dp
- Material Design 无障碍：触控目标 ≥48dp、间距 ≥8dp，实测 7–10mm
- 本项目 `docs/plans/2026-08-04-car-head-unit-quality-fix.md` §4 S3 触屏化
- 本项目 `src/components/NeumorphicButton.tsx`：`BTN=48`、`ICON_SIZE=20`
