# 虚拟屏顶部栏：触控无障碍与布局缺陷排查及优化方案

> 日期：2026-08-04
> 范围：`PaneDropdown` / `FullscreenDropdown` / `PaneSelector`（虚拟屏顶部悬浮控件栏）
> 状态：S4-1 / S4-2 已实施（2026-08-04，第四轮三组件结构终版）；S4-3 / S4-4 待实施

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

1. **触控目标直接做到 48px**——顶部栏是悬浮层，但 48px 工具栏按钮在车机屏上完全常规、并不笨重。直接采用「真实 48×48 按钮 + 20px 图标」（与项目 `NeumorphicButton` 的 `BTN=48` 一致），**不采用 `::after` 伪元素扩热区的取巧方案**。理由：真实 48px 按钮零歧义、零裁切、与侧边栏同源；`::after` 扩热区在相邻按钮间会**重叠 8px**（命中歧义，见 §7）且可能被祖先 `overflow-hidden` + `rounded-lg` 的圆角裁掉边角，复杂度换不来收益。
2. **消除 absolute 叠放**——改用 flex 三段式，让浏览器负责避让，从根上杜绝 A-1 / A-2 类重叠。
3. **消除重复**——`PaneDropdown` 与 `FullscreenDropdown` 结构 90% 重合，抽出共享原语。
4. **对齐项目既有基线**——复用 `NeumorphicButton` 的 48px / icon 20px 常量语义，与侧边栏一致。

### 4.2 交互原语（第六轮终版）：`TopBarHandle` + 同款 `TopBarActionButton`，样式全统一

> **第六轮反馈修订（2026-08-04，终版）**：用户要求**应用名、所有按钮均与上下拉按钮（`TopBarHandle`）同款样式，
> 不再使用侧边栏样式、保持简洁**。最终统一风格：**无底色、白色（危险操作红色系）+ 双层 drop-shadow
> 保可见、`active:scale-95` 按压缩放反馈**。应用名从深色胶囊标签改为纯白字 + 单层 drop-shadow。
> 顶部栏从此无任何背景元素（无胶囊、无半透明底），与侧边栏 NeumorphicButton 风格彻底脱钩。
> `NeumorphicButton` 的 `ariaLabel` 扩展保留（向后兼容，侧边栏未动）。
>
> 收起/展开把手为 `TopBarHandle`（`src/components/desktop/TopBarHandle.tsx`）：
> **折叠态与展开态渲染的是同一个元素**（同一组件、同尺寸 48×48 热区 / 28px 图标、同一锚点），
> 仅图标方向与 `expanded` 不同 → 两态位置**绝对一致**。

```tsx
// TopBarHandle.tsx —— 折叠/展开共用把手，无底色，drop-shadow 双影保可见
export function TopBarHandle({ icon: Icon, label, expanded, onClick }: TopBarHandleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className="pointer-events-auto relative flex items-center justify-center w-12 h-12 rounded-full shrink-0
                 text-white transition-transform touch-manipulation
                 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] drop-shadow-[0_0_8px_rgba(0,0,0,0.45)]
                 active:scale-95 active:text-white/85"
    >
      <Icon size={28} aria-hidden />
    </button>
  );
}
```

无障碍落实（B-1/B-3/B-4）：
- 48×48 真实触控目标（`TopBarActionButton` / `TopBarHandle` 均 48px，B-1 解决）；
- `active:scale-95` + 变色/加深提供触屏按压反馈（B-3 解决）；
- 全部按钮 `label` 必传 → `aria-label`（B-4 解决）。

### 4.3 顶部栏改为「居中胶囊工具条」（终版，用户 4 点反馈后修订）

> **实施反馈（2026-08-04）**：初版「全宽长条 + 收起靠右」被用户否定，提出 4 点意见，终版如下。
> **新发现的 P0（问题 1）**：全屏时 `SplitPane` 仍挂载于 DOM，其容器 `relative` 且 **z-index:auto 不创建 stacking context**，
> 导致内部 `PaneDropdown` 的 z-30 被提升到 `DesktopArea` 层级、盖过 `FullscreenOverlay` 的 z-10 → 全屏仍可见分屏控件。
> 修复：`SplitPane` 容器加 `z-0`（创建 stacking context），整棵分屏子树钉在覆盖层之下。

以 `FullscreenDropdown` 为例，**三组件紧贴布局**（第五轮终版）：

```tsx
<div className="absolute top-2 inset-x-0 z-30 pointer-events-none animate-fade-in">
  {/* 左半区(flex-1) | ②(shrink-0) | 右半区(flex-1)：
      左右半区等宽 → ② 严格居中 = 屏幕中心；①③ 内容分别右/左对齐 → 紧贴②。
      justify-center：折叠态仅②时也居中（flex 默认 flex-start 会顶到左侧）。
      间距 gap-3 一致。 */}
  <div className="flex items-center justify-center gap-3">
    {/* ① 左半区：应用名，内容右对齐贴②（仅展开态） */}
    {!collapsed && (
      <div className="flex-1 min-w-0 flex justify-end pointer-events-none animate-fade-in">
        <span className="max-w-[min(32vw,240px)] truncate text-white/90 text-sm
                         bg-slate-900/85 backdrop-blur-md rounded-full px-3 py-1.5 shadow-lg shadow-black/40">
          {displayName}
        </span>
      </div>
    )}

    {/* ② 上下拉（恒在、严格居中；折叠 ChevronDown / 展开 ChevronUp） */}
    <div className="shrink-0 pointer-events-auto">
      <TopBarHandle
        icon={collapsed ? ChevronDown : ChevronUp}
        label={collapsed ? '展开控件栏' : '收起控件栏'}
        expanded={!collapsed}
        onClick={toggle}
      />
    </div>

    {/* ③ 右半区：分屏 + 关闭，内容左对齐贴②（仅展开态） */}
    {!collapsed && (
      <div className="flex-1 flex justify-start items-center gap-2 pointer-events-auto animate-fade-in">
        <TopBarActionButton icon={SplitSquareHorizontal} label="分屏" onClick={...} />
        <TopBarActionButton icon={X} label="关闭应用" danger onClick={...} />
      </div>
    )}
  </div>
</div>
```

> **踩坑记录（2026-08-04）**：
> - grid 折叠态仅②一个子项时，auto-placement 会把它放进第一列 → 跑到左 1/3，须显式 `col-start` 钉列位；
> - flex 折叠态仅②时默认 `justify-content: flex-start` → 顶到最左，容器须加 `justify-center`；
> - 外层容器 `pointer-events-none` 下的子菜单必须显式 `pointer-events-auto`，否则触控穿透到虚拟屏。

**第五轮终版要点（用户多轮反馈收敛）**：
> 用户点破根因：「把整个组件当整体居中，但上拉按钮在组件内，并未与下拉按钮同位」；
> 「一直是一条横条，压根没变化」→ 去掉整条胶囊背景，三组件视觉分离；
> 上下拉位置修正后，再要求**左右组件紧挨上下拉，而非贴边缘**。

- **② 严格居中（机制级保证）**：左右半区 `flex-1` 等宽 → ② 中心 = 屏幕中心；折叠态仅② + `justify-center` → 同样居中，两态同一结构、绝对一致；
- **①③ 紧贴②**：①内容 `justify-end`（右对齐贴②）、③内容 `justify-start`（左对齐贴②），间距 `gap-3`（12px）一致；
- ①应用名 `max-w-[min(32vw,240px)]`（分屏 `min(24vw,180px)`）+ `title` 兜底；
- 子菜单：`absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-auto`（②正下方居中）。

此前各轮落实保留：
- **问题 1**：`SplitPane` 加 `z-0` 修复全屏穿透（见上）；
- 折叠态无底色 + `drop-shadow` 双影保可见（问题 2）；
- 白色系 `TopBarActionButton`（第三轮）；`z-30` 高于占位层。

### 4.4 折叠态触发器（终版：统一 `TopBarHandle`）

折叠态与展开态共用同一把手组件，仅图标方向与 `expanded` 不同：

```tsx
{/* 折叠态 = 双态同结构中「左右组隐藏」：同一容器、同一把手元素，
    透明无 padding，仅显示 ChevronDown 图标 */}
<div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-fade-in">
  <div className="flex items-center pointer-events-auto">
    <TopBarHandle icon={ChevronDown} label="展开控件栏" expanded={false} onClick={toggle} />
  </div>
</div>
```

- **去掉底色圆形**：正常状态下零遮挡（问题 2）；
- **可见性保障**：白色图标 + 双层 `drop-shadow`（近影保证锐利、远影保证在浅色画面上有晕圈），深浅画面均清晰；
- **两态绝对一致（第三轮）**：折叠态与展开态是**同一个把手元素**（同一容器、同一锚点、同一套 CSS），仅左右组显隐与图标方向不同 → 位置不可能不一致；
- 48×48 触控热区（B-1 解决），按压反馈为 `active:scale-95` + 轻微变暗；
- `aria-expanded` 由 `expanded` prop 透传（B-4 一致性）。

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
| 热区重叠（已在新方案中规避） | 原 `::after` 方案下相邻按钮 `gap-2`=8px、热区各外扩 8px → 命中区在间隙中**重叠 8px**，点击间隙会落在后序 DOM 按钮上，存在歧义。新方案改为**真实 48px 按钮**，相邻命中区以 8px 真实间隙分隔，零重叠、零裁切。 |

## 8. 参考

- Android Automotive OS Design System「Sizing」：触控目标 ≥76×76dp、间距 ≥24dp
- Material Design 无障碍：触控目标 ≥48dp、间距 ≥8dp，实测 7–10mm
- 本项目 `docs/plans/2026-08-04-car-head-unit-quality-fix.md` §4 S3 触屏化
- 本项目 `src/components/NeumorphicButton.tsx`：`BTN=48`、`ICON_SIZE=20`
