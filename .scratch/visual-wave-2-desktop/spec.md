# Spec: Wave 2 - 桌面流媒体与多窗区视觉与人机工效重构

> 状态：**ready-for-agent**
> 标签：`ready-for-agent`

---

## Problem Statement

CarWeb 在虚拟屏分屏桌面（`DesktopScreen`）中拥有复杂的多会话与流媒体悬浮控件体系（包含分屏顶栏、全屏切换栏、分屏位置选择器、活动进程管理器、分屏空态与转场占位等）。
在当前代码中，这些组件存在以下与最新规范（ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`）冲突的缺口：
1. **触控面积不达标**：
   - `ActivityManagerPanel.tsx` 的“进入”、“关闭”操作按钮仅使用 `p-1.5`（尺寸仅约 26px），远低于 48px 车机触控底线；底部“全部关闭”高度不足；
   - `PaneSelector.tsx` 的确认/取消按钮（`px-3 py-1.5`）高度仅约 32px；
2. **色彩体系混乱与裸色散落**：
   - `PaneSelector.tsx` 错误地大量使用了浅色模式颜色（`bg-slate-100`、`text-slate-700`、`text-slate-800`），在深色座舱主题中严重脱节；
   - `ActivityManagerPanel.tsx` 与各顶栏组件充斥着未抽象的裸色 `bg-slate-700`、`text-slate-400`、`bg-red-500`、`text-white`；
   - `SplitPane.tsx` 与 `DesktopShell.tsx` 边框与分隔条未对齐语义 Tokens；
3. **字号阶梯违规**：
   - 存在部分未规范的微型文本与角标，未统一保证 $\ge 12\text{px}$（`text-xs`）；
4. **缺少座舱冷调微毛玻璃统一**：
   - 视频悬浮层需要按照 ADR-0019 落地 **座舱冷调微毛玻璃（Translucent Cockpit Glass）**（`surface.elevated` 配合 `backdrop-blur-md` 与微弱冷阴影），在保障操作性的同时降低对投屏画面内容的视觉遮挡。

---

## Solution

1. 重构顶部悬浮控制栏（`TopBarActionButton.tsx`、`TopBarHandle.tsx`、`PaneDropdown.tsx`、`FullscreenDropdown.tsx`）：
   - 统一使用语义化 Token，常规按钮对齐 `text-content-secondary hover:text-content-primary`，危险关闭按钮对齐 `feedback-danger`（`text-red-400 active:text-red-300`）；
   - 保持 48x48px 物理触控靶区与 `gap-2`（8px）防误触间距；
   - 浮动标题对齐 `text-content-primary` 并增强半透明底衬。
2. 重构分屏选择器与活动进程浮窗（`PaneSelector.tsx`、`ActivityManagerPanel.tsx`）：
   - `PaneSelector.tsx` 彻底废除亮色样式，全面拥抱深色座舱（`bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`）；
   - 分屏选项项与覆盖确认按钮全面升级为 $\ge 48\text{px}$ 触控区（`min-h-[48px]`）；
   - `ActivityManagerPanel.tsx` 内部条目的“进入”、“关闭”按钮升级为独立 48x48px 透明外壳触控按钮（`w-12 h-12 flex items-center justify-center`）；底部全部关闭按钮升级为 `min-h-[48px]`。
3. 重构分屏与桌面外壳（`SplitPane.tsx`、`DesktopShell.tsx`、`DesktopScreen.tsx`、`PaneEmptyState.tsx`、`AppTransitionPlaceholder.tsx`、`VirtualScreen.tsx`）：
   - 统一背景为 `bg-surface-base`，容器分屏边框与中缝使用 `border-surface-card` 与 `surface-elevated`；
   - 空状态卡片与占位转场使用 `surface.card` 配合普惠体排版。
4. 补充自动化测试切面：
   - 新增 `src/components/desktop/__tests__/DesktopControls.test.tsx`，覆盖 TopBarActionButton、PaneDropdown、PaneSelector、ActivityManagerPanel 的 48px 靶区与深色座舱 Token 门禁。
   - 保持 `npm run test`、`npm run check`、`npm run lint` 三项全绿交付。
