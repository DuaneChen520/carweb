# 应用置顶与常用排序

## 概述

为虚拟屏的侧边栏和浮层面板增加三级应用排序：置顶应用（用户手动标记，可拖拽排序）→ 常用应用（按虚拟屏启动次数降序）→ 其余应用（按 DEX UsageStats 降序）。

## 数据层

### 新建 IndexedDB: `user-preferences`

与 `app-info-cache` 完全独立，便于分开清理。

**`pinned` store**
- keyPath: `packageName` (string)
- value: `{ packageName: string; order: number }`
- `order` 字段用于用户自定义排序，每次拖拽后批量重写

**`launch-counts` store**
- keyPath: `packageName` (string)
- value: `{ packageName: string; localCount: number; dexBaseline: number }`
- `localCount`: 用户通过虚拟屏启动次数，每次 +1
- `dexBaseline`: DEX 运行时从设备 UsageStats 获取的启动数，每次 DEX 运行覆盖

### 文件

- `src/lib/user-preferences-store.ts` — IndexedDB CRUD 封装
- `src/lib/app-sorter.ts` — 纯函数排序逻辑（可测试）

## DEX 扩展

`AppInfoFetcher.java` 新增 `UsageStatsManager` 查询：

```java
UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService("usagestats");
Calendar cal = Calendar.getInstance();
cal.add(Calendar.MONTH, -1);
Map<String, UsageStats> stats = usm.queryAndAggregateUsageStats(
    cal.getTimeInMillis(), System.currentTimeMillis());
```

每个 app 的 JSON 输出新增 `launchCount` 字段（int），查不到为 0，不阻塞主流程。

客户端 `AppInfoService.parseAllApps()` 中，DEX 返回后写入 `dexBaseline`，不影响已有 `localCount`。

## 排序逻辑

`src/lib/app-sorter.ts` 导出纯函数：

```typescript
function sortApps(
  allPackages: string[],
  pinned: Map<string, number>,
  launchCounts: Map<string, { localCount: number; dexBaseline: number }>
): string[]  // 按 pinned → frequent → other 排序的包名数组
```

排序规则：
1. 在 `pinned` map 中的 app，按 `order` 升序排列
2. 剩余 app 中 `localCount > 0` 的，按 `localCount` 降序排列
3. 其余 app 按 `dexBaseline` 降序排列

三区合并为一个平铺列表，无分区标题。搜索时对全部列表正常过滤。

## UI 交互

### 标题栏布局变更

`置顶按钮 | 刷新按钮 | 关闭按钮`

### 置顶模式

- 点击置顶按钮进入模式（按钮高亮，如蓝色）
- 模式中所有 AppIcon 右上角叠加图钉图标
- 点击 app 切换其置顶状态：实心图钉 = 已置顶，空心/无 = 未置顶
- 已置顶的 app 支持长按拖拽重新排序。
- 再次点击置顶按钮或关闭面板退出模式

### 侧边栏窄条

替换当前的 `getRecentApps()` 为上述排序后的列表，紧凑图标模式不变。

### 浮层面板「全部应用」网格

用排序后的列表替换当前 `filteredAll`，渲染方式不变（`grid grid-cols-3`）。

## 计数触发

两处递增 `localCount`：
1. `ControlSidebar.handleLaunchApp` — 点击 AppIcon 启动
2. `VirtualScreen.startAppOnDisplayFn` — 分辨率调整后恢复前台

调用 `UserPreferencesStore.incrementLaunchCount(pkg)` 做 IndexedDB upsert，fire-and-forget 不阻塞启动流程。

## 缓存清理

在侧边栏设置入口中提供两个独立清理按钮，各有二次确认弹窗：

| 操作 | 清理内容 |
|------|---------|
| 清除应用缓存 | `app-info-cache` 中的图标、标签、版本号 |
| 清除使用习惯 | `user-preferences` 中的 `pinned` + `launch-counts.localCount` |

弹窗文案只列清除项，不含内部实现术语。

## 变更文件清单

| 文件 | 操作 |
|------|------|
| `src/lib/user-preferences-store.ts` | 新增 |
| `src/lib/app-sorter.ts` | 新增 |
| `src/hooks/useAppPreferences.ts` | 新增 |
| `src/device-app-parser/AppInfoFetcher.java` | 修改（追加 UsageStats 查询） |
| `src/lib/device-app-parser.ts` | 修改（解析 launchCount 字段） |
| `src/lib/app-info-service.ts` | 修改（写入 dexBaseline） |
| `src/components/ControlSidebar.tsx` | 修改（标题栏加置顶按钮、排序逻辑、置顶模式 UI） |
| `src/components/VirtualScreen.tsx` | 修改（启动计数触发） |
| `src/hooks/scrcpy/useInputInjector.ts` | 修改（暴露 startApp 回调） |

## 未覆盖事项

- `@dnd-kit` 依赖引入或手写拖拽（实现时决定）
- 置顶模式中 AppIcon 的图钉叠加层样式细节
- 缓存清理 UI 入口的具体位置（浮层面板内或侧边栏底部）
