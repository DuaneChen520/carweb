# Issue 03: 重构桌面分屏外壳与虚拟屏容器

Status: resolved

## Comments

- `DesktopShell.tsx`：根容器升级为 `bg-surface-base select-none`，分屏间距提升至车机标准的 `gap-2 p-2`（8px）。
- `SplitPane.tsx`：容器升级为 `bg-surface-card rounded-2xl border border-surface-elevated/40 shadow-card`。
- `PaneEmptyState.tsx`：对齐 `text-content-muted`、`text-content-secondary` 与 `border-surface-elevated`。
- `AppTransitionPlaceholder.tsx`：文本与图标对齐 `text-content-primary` 与 `text-content-secondary`。
- `DesktopScreen.tsx` 与 `VirtualScreen.tsx`：外层主容器对齐 `bg-surface-base text-content-primary`，状态遮罩对齐 `surface.base/80 backdrop-blur-md`，错误重试按钮升级为 48px 触控靶区。
- `npm run check` 与 `npm run lint` 通过。
Type: task
Blocked by: 01, 02

## 目标

依据 ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`：
1. `src/components/desktop/DesktopShell.tsx` 与 `src/components/desktop/SplitPane.tsx`：
   - 统一外壳背景为 `bg-surface-base`；
   - 分屏容器间隙中缝（Split Divider）与边框对齐 `bg-surface-elevated/40` 与 `border-surface-card`；
2. `src/components/desktop/PaneEmptyState.tsx` 与 `src/components/desktop/AppTransitionPlaceholder.tsx`：
   - 空状态卡片对齐 `bg-surface-card/60 border border-surface-elevated/30`；
   - 转场占位底衬对齐 `bg-surface-base`，应用图标与文本采用语义 Token；
3. `src/components/DesktopScreen.tsx` 与 `src/components/VirtualScreen.tsx`：
   - 投屏背板统一使用 `bg-surface-base`，消除硬编码黑底；
   - 浮动层（如 TopBar、断线 overlay）层级与阴影对齐。
