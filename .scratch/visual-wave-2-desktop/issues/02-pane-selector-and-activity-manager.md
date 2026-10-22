# Issue 02: 重构分屏选择器与活动进程管理器

Status: resolved

## Comments

- `PaneSelector.tsx`：彻底废除全部亮色样式，全面拥抱深色座舱（`bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`）；分屏选项项与覆盖确认/取消按钮全面升级为 `min-h-[48px]` 的车机触控靶区。
- `ActivityManagerPanel.tsx`：面板升级为 `bg-surface-elevated/95 shadow-float`；操作按钮（进入/关闭/标题栏关闭）全部升级为独立 48x48px 触控区（`w-12 h-12`）；底部全部关闭按钮升级为 `min-h-[48px]`。
- `npm run check` 与 `npm run lint` 通过。
Type: task
Blocked by: 01

## 目标

依据 ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`：
1. `src/components/desktop/PaneSelector.tsx`：
   - 彻底废除亮色背景与亮色文字（如 `bg-slate-100`、`text-slate-700`、`border-slate-100`）；
   - 面板容器使用 `bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float p-2 space-y-1`；
   - 分屏选项项升级为 `min-h-[48px] px-3 py-2 rounded-xl text-left hover:bg-surface-hover/80 active:scale-[0.98] transition-all`；
   - 覆盖确认提示与按钮升级：取消与确认按钮均升级为 `min-h-[48px] px-4`，字号 $\ge 14\text{px}$；
2. `src/components/desktop/ActivityManagerPanel.tsx`：
   - 面板容器统一使用 `bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`；
   - 进程条目内部操作按钮（进入/关闭）升级为独立的 $48\times 48\text{px}$ 透明外壳按钮（`w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover/80 active:scale-95`）；
   - 底部“全部关闭”升级为 `min-h-[48px]`；
   - 彻底清除所有裸色和微型字号。
