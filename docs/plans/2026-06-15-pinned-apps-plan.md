# 应用置顶与常用排序 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为侧边栏和浮层面板增加三级应用排序：置顶（手动标记+拖拽排序）→ 常用（虚拟屏启动次数）→ 其余（DEX UsageStats）

**Architecture:** 新增独立 IndexedDB `user-preferences` 存储置顶列表和启动计数；DEX 端扩展 UsageStatsManager 查询作为 baseline；排序逻辑由纯函数 `app-sorter.ts` 完成。

**Tech Stack:** IndexedDB, Zustand (可选), @dnd-kit (拖拽, 可选), Java (DEX), TypeScript

---

### Task 1: UserPreferencesStore — IndexedDB 层

**Files:**
- Create: `src/lib/user-preferences-store.ts`
- Test: `src/lib/__tests__/user-preferences-store.test.ts`

**Step 1: 实现 UserPreferencesStore 类**

```typescript
// src/lib/user-preferences-store.ts
interface PinnedRecord {
  packageName: string;
  order: number;
}

interface LaunchCountRecord {
  packageName: string;
  localCount: number;
  dexBaseline: number;
}

export class UserPreferencesStore {
  private dbName = 'user-preferences';
  private storeVersion = 1;
  private db: IDBDatabase | null = null;

  private async openDB(): Promise<IDBDatabase> {
    // 创建/打开 DB，包含 'pinned' 和 'launch-counts' 两个 store
    // pinned: keyPath='packageName'
    // launch-counts: keyPath='packageName'
  }

  // Pinned operations
  async getPinned(): Promise<PinnedRecord[]>  // 按 order 排序返回
  async setPinned(records: PinnedRecord[]): Promise<void>  // 批量覆写
  async togglePinned(packageName: string): Promise<boolean>  // 切换置顶状态，返回新状态
  async isPinned(packageName: string): Promise<boolean>

  // Launch count operations
  async getLaunchCounts(): Promise<Map<string, LaunchCountRecord>>
  async incrementLaunchCount(packageName: string): Promise<void>
  async setDexBaseline(packageName: string, count: number): Promise<void>
  async bulkSetDexBaseline(entries: [string, number][]): Promise<void>

  // Clear operations
  async clearPinned(): Promise<void>
  async clearLocalCounts(): Promise<void>  // 只清 localCount，保留 dexBaseline
  async clearAll(): Promise<void>
}
```

**Step 2: 编写测试**

```typescript
// src/lib/__tests__/user-preferences-store.test.ts
// 测试 togglePinned 切换状态
// 测试 incrementLaunchCount 累加
// 测试 bulkSetDexBaseline 不覆盖已有 localCount
// 测试 clearLocalCounts 保留 dexBaseline
```

Run: `npx vitest run src/lib/__tests__/user-preferences-store.test.ts`

**Step 3: 提交**

```bash
git add src/lib/user-preferences-store.ts src/lib/__tests__/user-preferences-store.test.ts
git commit -m "feat: add UserPreferencesStore for pinned apps and launch counts"
```

---

### Task 2: AppSorter — 排序纯函数

**Files:**
- Create: `src/lib/app-sorter.ts`
- Test: `src/lib/__tests__/app-sorter.test.ts`

**Step 1: 实现 app-sorter.ts**

```typescript
// src/lib/app-sorter.ts
export interface LaunchCountData {
  localCount: number;
  dexBaseline: number;
}

export function sortApps(
  allPackages: string[],
  pinned: Map<string, number>,        // packageName → order
  launchCounts: Map<string, LaunchCountData>
): string[] {
  // 1. 'pinnedSet' = packages in pinned map, sorted by order
  // 2. remaining packages with localCount > 0, sorted by localCount desc
  // 3. remaining packages with dexBaseline > 0, sorted by dexBaseline desc
  // 4. rest in original order
}
```

排序规则：
- 置顶区：pinned map 中的 app，按 order 升序
- 常用区：剩余 app 中 `localCount > 0`，按 localCount 降序
- 其余区：按 `dexBaseline` 降序，同值的保留原始顺序

**Step 2: 编写测试**

```typescript
// 测试场景：
// 1. 置顶 app 排在最前
// 2. 常用 app 排在置顶之后
// 3. 其余 app 排在最后
// 4. 空 pinned / 空 launchCounts 的边界情况
// 5. 全部有 localCount 的场景
// 6. 排序稳定性（同 count 保留原始顺序）
```

Run: `npx vitest run src/lib/__tests__/app-sorter.test.ts`

**Step 3: 提交**

```bash
git add src/lib/app-sorter.ts src/lib/__tests__/app-sorter.test.ts
git commit -m "feat: add app sorting pure function for pinned/frequent/other tiers"
```

---

### Task 3: useAppPreferences — React Hook

**Files:**
- Create: `src/hooks/useAppPreferences.ts`

**Step 1: 实现 hook**

```typescript
// src/hooks/useAppPreferences.ts
export function useAppPreferences() {
  const storeRef = useRef(new UserPreferencesStore());

  const getPinnedApps = useCallback(async (): Promise<string[]> => {
    const records = await storeRef.current.getPinned();
    return records.map(r => r.packageName);
  }, []);

  const togglePin = useCallback(async (pkg: string): Promise<boolean> => {
    return storeRef.current.togglePinned(pkg);
  }, []);

  const reorderPinned = useCallback(async (orderedPkgs: string[]): Promise<void> => {
    const records = orderedPkgs.map((pkg, i) => ({ packageName: pkg, order: i }));
    await storeRef.current.setPinned(records);
  }, []);

  const incrementLaunchCount = useCallback(async (pkg: string): Promise<void> => {
    await storeRef.current.incrementLaunchCount(pkg);
  }, []);

  const getSortedApps = useCallback(async (
    allPackages: string[]
  ): Promise<string[]> => {
    const pinned = await storeRef.current.getPinned();
    const launchCounts = await storeRef.current.getLaunchCounts();
    const pinnedMap = new Map(pinned.map(p => [p.packageName, p.order]));
    return sortApps(allPackages, pinnedMap, launchCounts);
  }, []);

  const bulkSetDexBaseline = useCallback(async (entries: [string, number][]): Promise<void> => {
    await storeRef.current.bulkSetDexBaseline(entries);
  }, []);

  const clearUsageData = useCallback(async (): Promise<void> => {
    await storeRef.current.clearPinned();
    await storeRef.current.clearLocalCounts();
  }, []);

  // ...return memoized object
}
```

**Step 2: 提交**

```bash
git add src/hooks/useAppPreferences.ts
git commit -m "feat: add useAppPreferences hook for pin and launch count management"
```

---

### Task 4: DEX 端扩展 — AppInfoFetcher.java

**Files:**
- Modify: `src/device-app-parser/AppInfoFetcher.java`
- Modify: `src/device-app-parser/build.sh` (如有需要)

**Step 1: 追加 UsageStatsManager 查询**

在 `main()` 中获取 `PackageManager` 之后，新增：

```java
import android.app.usage.UsageStatsManager;
import android.app.usage.UsageStats;

// After getting PackageManager pm
UsageStatsManager usm = null;
Map<String, UsageStats> usageStatsMap = new HashMap<>();
try {
    Object ctx = getSystemContext(); // extract the context acquisition
    usm = (UsageStatsManager) ctx.getClass().getMethod("getSystemService", String.class)
        .invoke(ctx, "usagestats");
    if (usm != null) {
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.MONTH, -1);
        long startTime = cal.getTimeInMillis();
        long endTime = System.currentTimeMillis();
        List<UsageStats> statsList = usm.queryUsageStats(
            UsageStatsManager.INTERVAL_MONTHLY, startTime, endTime);
        if (statsList != null) {
            for (UsageStats stat : statsList) {
                usageStatsMap.put(stat.getPackageName(), stat);
            }
        }
    }
} catch (Exception e) {
    System.err.println("[USAGE] Failed: " + e.getMessage());
}
```

在 `AppInfo` 类中加字段：`public int launchCount;`
在循环赋值中：`appInfo.launchCount = stats.containsKey(pkg.packageName) ? stats.get(pkg.packageName).getTotalTimeForeground() / 1000 : 0;`
- 注：`getTotalTimeForeground()` 返回毫秒，除以 1000 转为秒作为近似计数。
- 或者用 `getTotalTimeVisible()` API 29+。

JSON 序列化中追加 `"launchCount":N`。

> 注意：需要从 `getPackageManager()` 中提取 `ctx` 对象复用，避免重复调用 `systemMain`。现有代码中 `ctx` 是方法的局部变量，需要重构使 `ctx` 在 `main()` 中可访问。

**Step 2: 编译 DEX**

```bash
cd src/device-app-parser && ./build.sh
```

检查 `public/app-info-fetcher.dex` 文件大小变化。

**Step 3: 提交**

```bash
git add src/device-app-parser/AppInfoFetcher.java public/app-info-fetcher.dex
git commit -m "feat: extend DEX parser with UsageStats launch count"
```

---

### Task 5: 客户端 DEX 解析集成

**Files:**
- Modify: `src/lib/device-app-parser.ts`
- Modify: `src/lib/app-info-service.ts`

**Step 1: 扩展 device-app-parser.ts**

在 `AppInfo` 接口追加 `launchCount: number;`：
```typescript
export interface AppInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
  launchCount: number;   // 新增
}
```

在 `parseJsonResult()` 中解析 `launchCount`：
```typescript
launchCount: typeof app.launchCount === 'number' ? app.launchCount : 0,
```

**Step 2: 扩展 app-info-service.ts**

在 `parseAllApps()` 中，解析完成后收集 `launchCount` 并调用 `bulkSetDexBaseline`：
```typescript
// After writing to AppInfoCache, collect launch counts
const baselineEntries: [string, number][] = [];
for (const app of deviceResult.apps) {
  baselineEntries.push([app.packageName, app.launchCount ?? 0]);
}

// Write dexBaseline via UserPreferencesStore
const prefsStore = new UserPreferencesStore();
await prefsStore.bulkSetDexBaseline(baselineEntries);
```

> 注意：`AppInfoService` 目前没有引用 `UserPreferencesStore`。简单的做法是直接 `new UserPreferencesStore()` 调用，不通过 DI。

**Step 3: 提交**

```bash
git add src/lib/device-app-parser.ts src/lib/app-info-service.ts
git commit -m "feat: integrate DEX launch count baseline into client-side storage"
```

---

### Task 6: ControlSidebar — 标题栏置顶按钮 + 模式切换

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: 标题栏追加置顶按钮**

在刷新按钮左侧添加：
```tsx
<button
  onClick={togglePinMode}
  className={`p-1 rounded transition-colors ${
    pinMode ? 'text-blue-400 bg-blue-500/20' : 'text-white/40 hover:text-white'
  }`}
  title={pinMode ? '退出置顶模式' : '置顶模式'}
>
  <Pin className="w-4 h-4" />
</button>
```

**Step 2: 状态管理**

```typescript
const [pinMode, setPinMode] = useState(false);
const [pinnedSet, setPinnedSet] = useState<Set<string>>(new Set());
const appPrefs = useAppPreferences();
```

**Step 3: togglePinMode 逻辑**

```typescript
const togglePinMode = useCallback(async () => {
  if (pinMode) {
    // 退出模式
    setPinMode(false);
  } else {
    // 进入模式，加载当前置顶列表
    const pinned = await appPrefs.getPinnedApps();
    setPinnedSet(new Set(pinned));
    setPinMode(true);
  }
}, [pinMode, appPrefs]);
```

**Step 4: AppIcon 在 pinMode 下的行为**

在 pinMode 中，点击 AppIcon 走 pin toggle 而非 launch：
```typescript
const handleAppClick = useCallback(async (pkg: string) => {
  if (pinMode) {
    const isNowPinned = await appPrefs.togglePin(pkg);
    setPinnedSet(prev => {
      const next = new Set(prev);
      isNowPinned ? next.add(pkg) : next.delete(pkg);
      return next;
    });
  } else {
    handleLaunchApp(pkg);
  }
}, [pinMode, appPrefs, handleLaunchApp]);
```

AppIcon 在 pinMode 中显示右上角图钉叠加层：已置顶的显示实心图钉，未置顶的显示空心图钉或透明占位。

**Step 5: 提交**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat: add pin mode toggle with visual feedback on app icons"
```

---

### Task 7: ControlSidebar — 三级排序接入

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: 替换 recentApps 和 apps 列表的排序逻辑**

在加载 app 列表时，使用 `appPrefs.getSortedApps()` 排序：

```typescript
// 在加载 apps 的回调中
const sortedApps = await appPrefs.getSortedApps(cachedPackages);

// 在加载 sidebar 列表时（原 recentApps 位置）
const sortedForSidebar = sortedApps; // 同一个排序结果
```

**Step 2: 侧边栏窄条渲染变更**

当前用 `recentApps`，改为用排序后的列表（compact AppIcon 不变）：
```tsx
{sidebarApps.map((pkg) => (
  <AppIcon
    key={pkg}
    pkg={pkg}
    name={appLabels.get(pkg) || '...'}
    getAppIcon={getAppIcon}
    onLaunch={handleLaunchApp}
    compact
    refreshKey={appListKey}
  />
))}
```

**Step 3: 浮层面板「全部应用」grid 使用排序列表**

```tsx
{filteredAll.map((pkg) => (
  <AppIcon key={pkg} ... />
))}
```
`filteredAll` 现在基于排序后的数组做过滤，保持排序。

**Step 4: 提交**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat: replace flat app list with three-tier sorted list"
```

---

### Task 8: 启动计数接入

**Files:**
- Modify: `src/components/ControlSidebar.tsx`
- Modify: `src/hooks/scrcpy/useInputInjector.ts`
- Modify: `src/components/VirtualScreen.tsx`

**Step 1: ControlSidebar — handleLaunchApp 中加计数**

```typescript
const handleLaunchApp = useCallback(async (pkg: string) => {
  startApp(pkg);
  await appPrefs.incrementLaunchCount(pkg);  // fire and forget
  setSearchText('');
  setPanelMode('closed');
  setTimeout(() => refreshRecentApps(), 500);
}, [startApp, appPrefs]);
```

**Step 2: VirtualScreen — startAppOnDisplay 中加计数**

`VirtualScreen` 需要能访问 `useAppPreferences`。最简单的方式是通过 `ControlSidebar` 引入，或在 VirtualScreen 层加一个 prop callback `onLaunchApp`。

更干净的方案：将 `incrementLaunchCount` 作为 `ScrcpyContext` 的一部分，或者直接在 `ControlSidebar` 中处理——因为 `startAppOnDisplay` 的本质也是启动 app，回调到 ControlSidebar。

```typescript
// VirtualScreen.tsx 中
// 在 startAppOnDisplay 之后调用 onAppLaunched(packageName) 回调
```

**Step 3: 提交**

```bash
git add src/components/ControlSidebar.tsx src/components/VirtualScreen.tsx
git commit -m "feat: increment local launch count on app launch"
```

---

### Task 9: 缓存清理 UI

**Files:**
- Create: `src/components/CacheSettingsDialog.tsx`
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: 创建设置弹窗组件**

```tsx
// src/components/CacheSettingsDialog.tsx
interface Props {
  open: boolean;
  onClose: () => void;
  onClearAppCache: () => void;
  onClearUsageData: () => void;
}
```

两个按钮：
- "清除应用缓存" — 调用 `clearAppInfoCache()`
- "清除使用习惯" — 调用 `clearUsageData()`

每个按钮点击后弹出 confirm 对话框，只列清除项。

**Step 2: 接入 ControlSidebar**

在标题栏或侧边栏底部加设置入口（齿轮图标）。

**Step 3: 提交**

```bash
git add src/components/CacheSettingsDialog.tsx src/components/ControlSidebar.tsx
git commit -m "feat: add cache settings with separate clear options and confirmation"
```

---

### Task 10: 长按拖拽排序（置顶管理）

**Files:**
- Modify: `src/components/ControlSidebar.tsx`
- Install: `@dnd-kit/core @dnd-kit/sortable` (如选 dnd-kit)

**Step 1: 在 pinMode 中启用拖拽**

只有 pinMode = true 且点击的是已置顶 app 时才启用拖拽。

实现方式（二选一）：
- Option A: `@dnd-kit` — `DndContext` + `SortableContext` + `useSortable`
- Option B: 手写 HTML5 drag & drop / pointer events

推荐 Option A 减少边界处理。

**Step 2: 拖拽结束后保存排序**

```typescript
const handleDragEnd = useCallback(async (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  // 重排 pinned 列表
  const newOrder = arrayMove(pinnedApps, oldIndex, newIndex);
  await appPrefs.reorderPinned(newOrder);
  setPinnedApps(newOrder);
}, [pinnedApps, appPrefs]);
```

**Step 3: 提交**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat: add long-press drag-and-drop reorder for pinned apps"
```

---

## 质量检查

每次提交前运行：
```bash
npm run lint && npm run check
```

最终验证：
```bash
npm run dev  # 手动验证交互
```
