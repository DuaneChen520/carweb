# Issue 04: Wave 2 桌面控件自动化测试与门禁验证

Status: resolved

## Comments

- 编写了 `src/components/desktop/__tests__/DesktopControls.test.tsx`，覆盖：
  - `TopBarActionButton` 与 `TopBarHandle` 48x48px 触控区与 Token 样式；
  - `PaneSelector` 深色座舱主题、选项与覆盖确认按钮 `min-h-[48px]`；
  - `ActivityManagerPanel` 独立进入/关闭按钮 48x48px 与全部关闭 `min-h-[48px]`；
  - 全量无 `text-[10px]`。
- 44 个测试套件、378 个测试用例全部通过。
- `npm run check` 与 `npm run lint` 全部通过。
Type: task
Blocked by: 01, 02, 03

## 目标

1. 编写自动化测试：`src/components/desktop/__tests__/DesktopControls.test.tsx`：
   - 验证 `TopBarActionButton` 48x48px 靶区与语义 Token；
   - 验证 `PaneSelector` 深色座舱主题、选项与确认按钮 `min-h-[48px]`；
   - 验证 `ActivityManagerPanel` 进程操作按钮 $48\times 48\text{px}$；
   - 验证全量桌面控件无 `text-[10px]`；
2. 执行三项验证全量通过：
   - `npm run test`
   - `npm run check`
   - `npm run lint`
