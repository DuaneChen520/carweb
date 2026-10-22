# Spec: Wave 1 - 常驻控制台外壳与核心触控工效重构

> 状态：**ready-for-agent**
> 标签：`ready-for-agent`

---

## Problem Statement

根据 `/grill-with-docs` 达成的系统设计决策（ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`），系统改造的第一波（Wave 1）聚焦于**全局外壳与常驻交互区**：
1. `ControlSidebar.tsx`（常驻侧边栏）：作为全屏与分屏桌面的公共侧栏，其根背景仍为硬编码 `bg-slate-950`，分割线为裸色；更关键的是其二级设置面板仅有 `w-44`（176px），且内部散落着高度仅 20px 的裸色小药丸按钮和 `text-[10px]` 字体，易在车载颠簸中引发误触；
2. `AppIcon.tsx`（Dock 与应用图标）：存在 `text-[10px]` 不可读文字，且触控与按压反馈缺乏即时防抖机制；
3. `NowPlayingCard.tsx`（流媒体卡片）：控制按钮（上一首/播放/下一首）尺寸低于 48px，时间戳使用 `text-[10px]`，背景为纯裸色 `bg-white/5`；
4. `App.tsx`：根容器背景为旧的 `bg-slate-900`，未对齐 `bg-surface-base` 语义 Token。

---

## Solution

1. 重构 `ControlSidebar.tsx`：
   - 侧栏根容器迁移至 `bg-surface-base border-r border-surface-card`，Dock 间距锁死 $\ge 8\text{px}$；
   - 彻底重构右下角设置面板：宽度从 176px 拓宽至 256px（`w-64`），背景采用 `surface.elevated` + `shadow-float`；
   - 将内部“键盘模式”、“启动 PIN”、“音频输出”、“显示模式”、“画质”与“缓存设置”全部升级为 **整行触控项 (List Row $\ge 48\text{px}$)**，文字提升至 $\ge 14\text{px}$，杜绝微型药丸按钮；
   - 活动进程角标提升至 $\ge 12\text{px}$（`text-xs`）。
2. 重构 `AppIcon.tsx`：
   - 紧凑模式保证 $48\times 48\text{px}$ 物理触控区（36px 图标 + 6px 留白）；
   - 应用名提升至 `text-xs`（12px）并以 `truncate` 兜底；
   - 置顶 Pin 角标提升并语义化为 `accent`。
3. 重构 `NowPlayingCard.tsx`：
   - 背景与边框迁移至 `surface.card` 与 `surface.elevated`；
   - 媒体控制按钮全部统一为 $48\times 48\text{px}$ 触控靶区与 `gap-2`（8px）防误触间距；
   - 进度条时间戳拔高至 `text-xs font-mono`。
4. 重构 `App.tsx` 根容器：
   - 统一接入 `bg-surface-base text-content-primary antialiased select-none`。
5. 补充单测切面：
   - 新增 `src/components/__tests__/ControlSidebar.test.tsx` 与 `src/components/__tests__/NowPlayingCard.test.tsx`，硬性断言 48px 触控区与字号下限。
   - 确保 `npm run test`、`npm run check`、`npm run lint` 三项全量通过。
