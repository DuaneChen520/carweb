# ADR-0012：应用显示名采用渲染时按包名查缓存（pull 模型）

- 状态：Accepted
- 日期：2026-07-14
- 来源：grill-with-docs 会话——用户质疑「顶部应用名称为什么显示的是包名缩写而非真实名称」。

## 背景（Context）

顶部下拉（`PaneDropdown` / `FullscreenDropdown`）、分屏选择（`PaneSelector`）、活动进程（`ActivityManagerPanel`）、启动占位（`AppTransitionPlaceholder`）、应用网格（`AppGrid`）、侧栏 dock（`ControlSidebar`）均展示应用名称。修改前它们共用一行兜底：

```ts
const displayName = app.appLabel || app.packageName.split('.').pop() || app.packageName;
```

`split('.').pop()` 即用户看到的「包名缩写」（`com.tencent.mm` → `mm`）。它是兜底分支，意味着首选的 `app.appLabel` 恒为空。

## 根因

`AppInstance.appLabel` 字段存在且一路透传（`launchOnPane(pkg, pane, cfg, appLabel)` / `launchFullscreen(pkg, cfg, appLabel)` → `AppInstance.appLabel = appLabel`），但**启动调用点从未传入该参数**：

- `src/components/DesktopScreen.tsx:203` `launchOnPane(task.pkg, task.slot, buildPaneDisplayConfig(task.slot))`
- `:228` `launchOnPane(pkg, pane, buildPaneDisplayConfig(pane))`
- `:232` `launchFullscreen(pkg, buildFullscreenDisplayConfig())`

→ `appLabel` 恒为 `undefined` → 所有控件走 `split('.').pop()` 缩写兜底。

真实名称其实可用：`app-info-service.parseAllApps` 已从设备端 `AppInfoFetcher.java` 解析出 `label` 并缓存；`getCachedAppLabels(pkgs)` 也暴露 `Map<pkg,label>`，`ControlSidebar` 已在用相同方式显示侧栏名称。故这是**数据未贯通**，非数据源缺失。

## 决策

### D1：渲染时按包名查缓存（pull 模型）

新增 `src/lib/useAppDisplayName.ts`：

- 纯函数 `resolveAppDisplayName(label, pkg)` → `label || pkg`。
- 钩子 `useAppLabels(pkgs)`：渲染时调 `getCachedAppLabels(pkgs)` 批量解析，`Map<pkg, 显示名>`。
- 钩子 `useAppDisplayName(pkg)`：单条封装。

所有显示名在**渲染时**经上述钩子按包名查缓存获得。

**否决项——push 模型（启动调用点透传 `appLabel`）：**
1. 需所有启动入口都能拿到 label，但 task 队列 / 媒体 / NowPlaying 等入口本就只有包名，仍需兜底；
2. `appLabel` 一旦写入不随缓存刷新，跨 `resumeBackground` / `backgroundify` / `paneToFullscreen` 易失配；
3. pull 模型单一数据源 = 设备缓存，自动随扫描刷新，且天然覆盖全部入口。

### D2：兜底显示完整包名（不再用末段缩写）

label 缺失（首次启动、设备未扫完）时显示**完整包名**（如 `com.tencent.mm`），不再用 `split('.').pop()` 缩写——后者不可读，已于本 ADR 全面废弃（`AppGrid` / `AppIcon` / `ControlSidebar` 的 `name={... || pkg.split('.').pop() || pkg}` 一并改为 `... || pkg`）。

## 影响 / 改动文件

- 新增 `src/lib/useAppDisplayName.ts`（钩子 + 纯函数）。
- `PaneDropdown.tsx` / `FullscreenDropdown.tsx` / `PaneSelector.tsx` / `ActivityManagerPanel.tsx`：改用 `useAppDisplayName` / `useAppLabels`。
- `AppTransitionPlaceholder.tsx`：内部 `useAppDisplayName(pkg)` 自解析，移除冗余 `name` prop；`SplitPane.tsx` / `FullscreenOverlay.tsx` 调用处同步去除 `name={app.appLabel}`。
- `AppGrid.tsx` / `AppIcon.tsx` / `ControlSidebar.tsx`：移除缩写兜底，统一 `... || pkg`。
- 单测 `src/lib/__tests__/useAppDisplayName.test.ts`（`resolveAppDisplayName`）。

## 验证

- `npm run check` 0 错误；`npm run build` 成功（仅既有 chunking 警告）。
- `vitest run useAppDisplayName.test.ts` 2 passed。
- 真机待用户确认：顶部下拉、启动占位、活动进程列表均显示真实名称；首次启动（缓存未就绪）回退完整包名而非 `mm` 缩写。
