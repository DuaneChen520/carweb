# Recent Apps Sidebar

## 目标

将 ControlSidebar 顶部固定应用列表替换为最近打开的应用，基于 ADB `dumpsys activity recent-tasks` 实时获取系统最近任务。

## 改动范围

### 1. `adb-commands.ts` — 新增 `getRecentTasks()`

- 执行 `dumpsys activity recent-tasks -20`
- 正则匹配 `realActivity=`、`mOrigActivity=`、`cmp=` 后的包名
- 按首次出现顺序去重，返回包名数组

### 2. `useAppManager.ts` — 新增 `getRecentApps()`

- 调用 `getRecentTasks(adb)` 获取包名列表
- 调用 `batchGetAppLabels()` 批量查标签（走缓存或 ADB）
- 返回 `AppInfo[]`（`{ packageName, label }`），图标由 `AppIcon` 组件延迟加载

### 3. `useScrcpySession.ts` — 暴露 `getRecentApps`

将 `appManager.getRecentApps` 合并到 session 返回值。

### 4. `ScrcpyContext.tsx` — 暴露 `getRecentApps`

接口增加 `getRecentApps: (maxCount?: number) => Promise<AppInfo[]>`。

### 5. `ControlSidebar.tsx` — 替换固定应用区

- 移除 `PRIORITY_PACKAGES` 和 `pinnedApps` 逻辑
- 侧边栏顶部改为 `recentApps` 状态，首次渲染调用 `getRecentApps(15)`
- 保留 `AppIcon` 网格布局、`compact` 模式不变
- 搜索面板中的「常用」区也改为最近应用

## 边界处理

| 场景 | 行为 |
|------|------|
| ADB 断开 | catch 内调用 `getAllCachedPackages()` 兜底显示缓存列表 |
| 最近任务为空 | 侧边栏顶部留白 |
| 同一 app 多条 | 按首次出现去重 |
| 刷新时机 | 仅侧边栏首次渲染时拉取一次 |
| 图标未缓存 | 由 `AppIcon` 组件的 `IntersectionObserver` 延迟加载 |
