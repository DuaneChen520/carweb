# 增量应用加载实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现连接手机后自动获取应用列表，通过 quick dex 快速对比缓存，增量更新应用信息

**Architecture:** 连接后先执行 quick dex 获取包名+版本号列表，对比 IndexedDB 缓存决定是否需要执行完整 dex，避免不必要的全量解析

**Tech Stack:** TypeScript, Java (DEX), ADB, IndexedDB

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/device-app-parser/AppInfoFetcherQuick.java` | 快速获取包名+版本号的 DEX | 已存在，需编译 |
| `public/app-info-fetcher-quick.dex` | 编译后的 quick DEX | 新建 |
| `src/lib/device-app-parser.ts` | 添加 quick dex 执行方法 | 修改 |
| `src/lib/app-info-service.ts` | 添加 syncWithDevice 方法 | 修改 |
| `src/hooks/scrcpy/useScrcpySession.ts` | 修改连接后逻辑 | 修改 |

---

## Task 1: 编译 AppInfoFetcherQuick DEX

**Covers:** 基础设施

**Files:**
- Create: `public/app-info-fetcher-quick.dex`
- Modify: `src/device-app-parser/build.sh`

- [ ] **Step 1: 检查 build.sh 是否支持 quick dex**

读取 `src/device-app-parser/build.sh`，确认是否已有编译 quick dex 的逻辑。

- [ ] **Step 2: 修改 build.sh 添加 quick dex 编译**

在 `build.sh` 中添加编译 `AppInfoFetcherQuick.java` 的命令：

```bash
#!/bin/bash
# 编译完整版 DEX
cd src/device-app-parser
javac -source 1.8 -target 1.8 -bootclasspath android.jar \
  -d build AppInfoFetcher.java
dx --dex --output=../../public/app-info-fetcher.dex build

# 编译快速版 DEX
javac -source 1.8 -target 1.8 -bootclasspath android.jar \
  -d build AppInfoFetcherQuick.java
dx --dex --output=../../public/app-info-fetcher-quick.dex build
```

- [ ] **Step 3: 执行编译**

```bash
cd src/device-app-parser && ./build.sh
```

Expected: 生成 `public/app-info-fetcher-quick.dex`

- [ ] **Step 4: 验证 DEX 文件**

```bash
ls -la public/app-info-fetcher*.dex
```

Expected: 两个 DEX 文件都存在

- [ ] **Step 5: Commit**

```bash
git add public/app-info-fetcher-quick.dex src/device-app-parser/build.sh
git commit -m "feat: compile AppInfoFetcherQuick DEX for fast package listing"
```

---

## Task 2: DeviceAppParser 添加 quick dex 支持

**Covers:** 快速获取包名+版本号

**Files:**
- Modify: `src/lib/device-app-parser.ts`
- Test: `src/lib/device-app-parser.test.ts`

- [ ] **Step 1: 添加 QuickAppInfo 接口**

在 `src/lib/device-app-parser.ts` 中添加接口定义（在 `AppInfo` 接口附近）：

```typescript
export interface QuickAppInfo {
  packageName: string;
  versionCode: number;
}
```

- [ ] **Step 2: 添加 quick DEX URL 常量**

在 `DeviceAppParser` 类中添加：

```typescript
private static readonly QUICK_DEX_URL = import.meta.env.BASE_URL + 'app-info-fetcher-quick.dex';
private static readonly QUICK_DEX_PATH = '/data/local/tmp/app-info-fetcher-quick.dex';
```

- [ ] **Step 3: 添加 executeQuickDex 方法**

在 `DeviceAppParser` 类中添加：

```typescript
async executeQuickDex(adb: Adb): Promise<QuickAppInfo[]> {
  const startTime = Date.now();
  console.log('[DeviceAppParser] ===== 执行 Quick DEX =====');

  // 下载并推送 quick DEX
  const response = await fetch(DeviceAppParser.QUICK_DEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Quick DEX: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const sync = await adb.sync();
  await sync.write({
    filename: DeviceAppParser.QUICK_DEX_PATH,
    file: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(arrayBuffer));
        controller.close();
      },
    }),
  });

  // 生成并推送脚本
  const scriptContent = this.generateQuickScript(DeviceAppParser.QUICK_DEX_PATH);
  await this.pushScript(adb, scriptContent);

  // 执行脚本
  console.log('[DeviceAppParser] 执行 Quick DEX 脚本...');
  let result: string;
  if (adb.subprocess.shellProtocol) {
    const waitResult = await adb.subprocess.shellProtocol.spawnWaitText(['sh', DeviceAppParser.SCRIPT_PATH]);
    result = waitResult.stdout;
  } else {
    result = await adb.subprocess.noneProtocol.spawnWaitText(['sh', DeviceAppParser.SCRIPT_PATH]);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[DeviceAppParser] Quick DEX 执行完成, 耗时: ${elapsed}ms`);

  // 清理
  await this.cleanupQuickDex(adb).catch(() => {});

  // 解析结果
  return this.parseQuickJsonResult(result);
}
```

- [ ] **Step 4: 添加 generateQuickScript 方法**

```typescript
private generateQuickScript(dexPath: string): string {
  return `#!/system/bin/sh
export ANDROID_DATA=/data
export ANDROID_ROOT=/system
export CLASSPATH=${dexPath}
mkdir -p /data/dalvik-cache
app_process /system/bin com.carweb.appinfo.AppInfoFetcherQuick
`;
}
```

- [ ] **Step 5: 添加 parseQuickJsonResult 方法**

```typescript
parseQuickJsonResult(jsonString: string): QuickAppInfo[] {
  console.log(`[DeviceAppParser] Quick DEX 响应: ${jsonString.length} bytes`);

  if (jsonString.startsWith('Error:') || jsonString.startsWith('Exception:')) {
    throw new Error(`Quick DEX execution failed: ${jsonString}`);
  }

  const jsonEnd = jsonString.lastIndexOf('}');
  if (jsonEnd > 0) {
    jsonString = jsonString.substring(0, jsonEnd + 1);
  }

  const result = JSON.parse(jsonString) as Record<string, unknown>;

  if (!result.apps || !Array.isArray(result.apps)) {
    throw new Error('Invalid Quick DEX result: missing apps array');
  }

  const apps: QuickAppInfo[] = [];
  for (const raw of result.apps) {
    if (raw == null || typeof raw !== 'object') continue;
    const app = raw as Record<string, unknown>;
    if (typeof app.packageName === 'string' && typeof app.versionCode === 'number') {
      apps.push({
        packageName: app.packageName,
        versionCode: app.versionCode,
      });
    }
  }

  console.log(`[DeviceAppParser] Quick DEX 解析完成: ${apps.length} 个应用`);
  return apps;
}
```

- [ ] **Step 6: 添加 cleanupQuickDex 方法**

```typescript
private async cleanupQuickDex(adb: Adb): Promise<void> {
  const command = `rm -f '${DeviceAppParser.QUICK_DEX_PATH}' '${DeviceAppParser.SCRIPT_PATH}'`;
  if (adb.subprocess.shellProtocol) {
    await adb.subprocess.shellProtocol.spawnWaitText(command);
  } else {
    await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', command]);
  }
}
```

- [ ] **Step 7: 导出 QuickAppInfo**

在文件顶部的导出中添加 `QuickAppInfo`。

- [ ] **Step 8: Commit**

```bash
git add src/lib/device-app-parser.ts
git commit -m "feat: add executeQuickDex method for fast package listing"
```

---

## Task 3: AppInfoService 添加 syncWithDevice 方法

**Covers:** 缓存对比逻辑

**Files:**
- Modify: `src/lib/app-info-service.ts`
- Test: `src/lib/app-info-service.test.ts`

- [ ] **Step 1: 添加 SyncResult 接口**

在 `src/lib/app-info-service.ts` 中添加：

```typescript
export interface SyncResult {
  /** 需要解析的应用包名列表 */
  toParse: string[];
  /** 设备上所有应用的包名+版本号 */
  deviceApps: Map<string, number>;
}
```

- [ ] **Step 2: 添加 syncWithDevice 方法**

在 `AppInfoService` 类中添加：

```typescript
async syncWithDevice(adb: Adb, signal?: AbortSignal): Promise<SyncResult> {
  console.log('[AppInfoService] 开始同步设备应用列表...');

  // 获取设备上的应用列表（快速）
  const deviceApps = await this.deviceParser.executeQuickDex(adb);

  // 对比缓存
  const toParse: string[] = [];
  for (const app of deviceApps) {
    const cached = await this.cache.get(app.packageName);
    if (!cached || cached.versionCode !== app.versionCode) {
      toParse.push(app.packageName);
    }
  }

  console.log(`[AppInfoService] 同步完成: 设备 ${deviceApps.length} 个应用, 需解析 ${toParse.length} 个`);

  return {
    toParse,
    deviceApps: new Map(deviceApps.map(a => [a.packageName, a.versionCode])),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/app-info-service.ts
git commit -m "feat: add syncWithDevice method for cache comparison"
```

---

## Task 4: 修改 useScrcpySession 自动触发同步

**Covers:** 连接后自动加载

**Files:**
- Modify: `src/hooks/scrcpy/useScrcpySession.ts`

- [ ] **Step 1: 修改 startScrcpy 成功后的逻辑**

将之前添加的自动触发 dex 解析改为使用 syncWithDevice：

```typescript
// 后台自动同步应用列表
appManager.syncWithDevice(adb).then(async (syncResult) => {
  if (syncResult.toParse.length > 0) {
    console.log(`[ScrcpySession] 需要解析 ${syncResult.toParse.length} 个应用`);
    // 执行完整 dex 解析
    await appManager.parseAllApps(false);
  } else {
    console.log('[ScrcpySession] 缓存完全命中，跳过 dex 解析');
  }
}).catch((err) => {
  console.warn('[ScrcpySession] 后台同步应用列表失败:', err);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/scrcpy/useScrcpySession.ts
git commit -m "feat: auto-sync app list on connection with cache comparison"
```

---

## Task 5: 修改 ControlSidebar 优先从缓存读取

**Covers:** UI 优化

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

- [ ] **Step 1: 修改 loadApps 函数**

确保 loadApps 优先从缓存读取（已在之前实现）：

```typescript
const loadApps = useCallback(async () => {
  setLoading(true);
  setPanelMode('apps');
  try {
    // 先尝试从缓存读取（后台自动解析可能已完成）
    const cachedPackages = await scrcpy.getAllCachedPackages();
    if (cachedPackages.length > 0) {
      setApps(cachedPackages);
      const labels = await scrcpy.getCachedAppLabels(cachedPackages);
      setAppLabels(labels);
      setLoading(false);
      return;
    }

    // 缓存为空，触发 DEX 解析
    await parseAllApps(false, (p) => setParseProgress(p));

    // DEX 完成后从缓存读取最终结果
    const allPackages = await scrcpy.getAllCachedPackages();
    setApps(allPackages);
    const labels = await scrcpy.getCachedAppLabels(allPackages);
    setAppLabels(labels);
    setParseProgress(null);
  } catch {
    setParseProgress(null);
  } finally {
    setLoading(false);
  }
}, [parseAllApps, scrcpy]);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat: prioritize cache read in ControlSidebar"
```

---

## Task 6: 运行测试验证

**Covers:** 验证

- [ ] **Step 1: 运行类型检查**

```bash
npm run check
```

Expected: 无错误

- [ ] **Step 2: 运行测试**

```bash
npm run test
```

Expected: 所有测试通过

- [ ] **Step 3: 运行 lint**

```bash
npm run lint
```

Expected: 无新增错误

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete incremental app loading implementation"
```

---

## 验证清单

- [ ] 连接手机后自动执行 quick dex
- [ ] quick dex 结果与缓存对比正确
- [ ] 有差异时自动执行完整 dex
- [ ] 无差异时跳过 dex 解析
- [ ] 缓存读取正常
- [ ] UI 显示正确
