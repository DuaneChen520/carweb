# Issue 02: 重构 AppPicker 与 AppGrid

Status: resolved
Type: task

## Comments

- `src/components/AppPicker.tsx`：
  - 浮动面板容器升级为冷调微毛玻璃：`bg-surface-elevated/95 backdrop-blur-xl rounded-2xl border border-surface-card shadow-float`；
  - 顶栏控件组规范间距 `gap-2`；搜索输入框升级为 `bg-surface-base border border-surface-card text-content-primary placeholder:text-content-muted min-h-[44px]`；
  - 置顶模式按钮、刷新按钮、关闭按钮全部升级为 48x48px 触控靶区（`w-12 h-12 flex items-center justify-center rounded-xl`）并配备 active:scale-95 与 focus-visible 焦点环；
  - 标题对齐 `text-content-primary`，应用总数角标对齐 `text-content-muted text-xs`。
- `src/components/AppGrid.tsx`：
  - 加载中文案与空匹配文案统一为 `text-content-secondary text-sm`；
  - 页面指示器圆点对齐 `bg-content-muted/30` 语义 Token。
- 全量测试通过，`npm run check` 与 `npm run lint` 全绿。
