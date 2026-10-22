# Issue 01: 重构顶部悬浮控制栏与分屏折叠控件

Status: resolved

## Comments

- `TopBarActionButton.tsx`：升级为 `text-content-primary` 与 `text-red-400 active:text-red-300`，保持 48x48px 触控靶区与防跳变 active scale。
- `TopBarHandle.tsx`：升级为 `text-content-primary` 与 48x48px 把手。
- `PaneDropdown.tsx` 与 `FullscreenDropdown.tsx`：间距规范为 `gap-2`，标题对齐 `text-content-primary` 配合半透明底衬胶囊；分屏弹窗外层升级为 `bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`。
- `npm run check` 与 `npm run lint` 通过。
Type: task

## 目标

依据 ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`，对以下组件执行重构：
1. `src/components/desktop/TopBarActionButton.tsx`：
   - 保持 48x48px 靶区（`w-12 h-12`），消除裸白色与硬编码 red，统一采用 `text-content-primary` 与 `text-red-400 active:text-red-300`；
   - 适配 `active:scale-95 transition-all`；
2. `src/components/desktop/TopBarHandle.tsx`：
   - 统一 48x48px 触控区与座舱冷调微阴影；
3. `src/components/desktop/PaneDropdown.tsx` 与 `src/components/desktop/FullscreenDropdown.tsx`：
   - 控件组间距统一为 `gap-2`（8px）；
   - 应用标题对齐 `text-content-primary text-sm font-medium`，背景底衬采用轻量 `bg-surface-base/60 backdrop-blur-md px-3 py-1 rounded-full`；
   - 消除所有裸色与不可读字阶。
