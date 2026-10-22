# Issue 03: App 根容器对齐与 Wave 1 自动化回归门禁测试

Status: resolved

## Comments

- `App.tsx` 根容器升级为 `bg-surface-base text-content-primary antialiased select-none`。
- 新增 `src/components/__tests__/ControlSidebar.test.tsx`：自动化断言侧栏 `bg-surface-base`、设置面板 `w-64`、各项最小高度 $\ge 48\text{px}$、全局杜绝 `text-[10px]`。
- 新增 `src/components/__tests__/NowPlayingCard.test.tsx`：断言上一首/播放/下一首按钮尺寸均为 48x48px，时间戳使用 `text-xs`，背景为 `surface.card`。
- 新增 `src/components/__tests__/AppIcon.test.tsx`：断言 Dock 模式 48x48px 触控区，非 compact 模式 `text-xs`，无 10px。
- 三项验证全部通过：
  - `npm run test`: 38 passed (344 tests)
  - `npm run check`: 0 errors
  - `npm run lint`: 0 errors
Type: task
Blocked by: 01, 02

## 目标

1. 更新 `src/App.tsx` 根容器背景，接入 `bg-surface-base text-content-primary antialiased select-none`；
2. 新增单元测试切面：
   - `src/components/__tests__/ControlSidebar.test.tsx`：断言侧边栏外壳样式、设置面板宽度 `w-64`、设置条目最小高度 $\ge 48\text{px}$、无 `text-[10px]`；
   - `src/components/__tests__/NowPlayingCard.test.tsx`：断言媒体控制按钮尺寸 $\ge 48\times 48\text{px}$、间距 $\ge 8\text{px}$、时间戳字号 $\ge 12\text{px}$；
3. 执行三项验证全量通过：
   - `npm run test`
   - `npm run check`
   - `npm run lint`
