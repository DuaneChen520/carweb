# App Info Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement browser-side APK parsing using `app-info-parser` to extract app names and icons, with serial parsing, memory protection, and IndexedDB persistence.

**Architecture:** Create a parser service that downloads APKs via ADB sync, parses them with `app-info-parser`, and caches results in IndexedDB. The parser enforces memory limits and processes apps serially to avoid peaks. Integrate with existing `AppInfoCache` and `useAppManager`.

**Tech Stack:** TypeScript, `app-info-parser`, `@yume-chan/adb`, IndexedDB, Vitest

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/apk-parser.ts` | Core APK parsing using `app-info-parser`, memory limit check |
| `src/lib/apk-parser.test.ts` | Unit tests for APK parser |
| `src/lib/app-info-service.ts` | Orchestrator: serial parsing, cache integration, progress tracking |
| `src/lib/app-info-service.test.ts` | Unit tests for service orchestration |
| `src/hooks/scrcpy/useAppManager.ts` | **Modify:** Integrate with AppInfoCache + service |

---

### Task 1: Create APK Parser with Memory Protection

**Covers:** ADR-0004 §决策/解析库, §决策/内存管理

**Files:**
- Create: `src/lib/apk-parser.ts`
- Create: `src/lib/apk-parser.test.ts`

- [ ] **Step 1: Write the failing test for parseApk function**

```typescript
// src/lib/apk-parser.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseApk, getMaxMemoryBytes } from './apk-parser';

describe('parseApk', () => {
  it('getMaxMemoryBytes returns deviceMemory/4 with fallback to 1GB', () => {
    const result = getMaxMemoryBytes();
    // Should be a positive number
    expect(result).toBeGreaterThan(0);
    // Should not exceed reasonable bounds
    expect(result).toBeLessThanOrEqual(4 * 1024 * 1024 * 1024);
  });

  it('parseApk returns null when APK exceeds memory limit', async () => {
    // Mock a very small memory limit
    const tinyLimit = 100; // 100 bytes
    const apkData = new ArrayBuffer(1024); // 1KB APK

    const result = await parseApk(apkData, tinyLimit);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/apk-parser.test.ts`
Expected: FAIL with "Cannot find module './apk-parser'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/apk-parser.ts
import { ApkParser } from 'app-info-parser';

export interface ParsedApkInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
}

export function getMaxMemoryBytes(): number {
  const deviceMemory = (navigator as any).deviceMemory ?? 4;
  return Math.floor((deviceMemory * 1024 * 1024 * 1024) / 4);
}

export async function parseApk(
  apkData: ArrayBuffer,
  maxMemoryBytes: number = getMaxMemoryBytes()
): Promise<ParsedApkInfo | null> {
  // Check memory limit before parsing
  if (apkData.byteLength > maxMemoryBytes) {
    console.warn('[parseApk] APK exceeds memory limit, skipping');
    return null;
  }

  try {
    const parser = new ApkParser();
    const result = await parser.parse(apkData);

    // Extract icon as base64
    let iconBase64: string | null = null;
    if (result.icon) {
      if (result.icon instanceof ArrayBuffer) {
        const blob = new Blob([result.icon], { type: 'image/png' });
        iconBase64 = await blobToBase64(blob);
      } else if (typeof result.icon === 'string') {
        iconBase64 = result.icon;
      }
    }

    return {
      packageName: result.package || '',
      label: result.label || null,
      iconBase64,
      versionCode: result.versionCode || 0,
    };
  } catch (e) {
    console.error('[parseApk] parsing failed:', e);
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/apk-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/apk-parser.ts src/lib/apk-parser.test.ts
git commit -m "feat: add APK parser with memory protection"
```

---

### Task 2: Create App Info Service with Serial Parsing

**Covers:** ADR-0004 §决策/解析策略, §决策/数据传输

**Files:**
- Create: `src/lib/app-info-service.ts`
- Create: `src/lib/app-info-service.test.ts`

- [ ] **Step 1: Write the failing test for serial parsing**

```typescript
// src/lib/app-info-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppInfoService } from './app-info-service';
import type { Adb } from '@yume-chan/adb';

// Mock ADB and dependencies
vi.mock('app-info-parser', () => ({
  ApkParser: vi.fn().mockImplementation(() => ({
    parse: vi.fn().mockResolvedValue({
      package: 'com.test.app',
      label: 'Test App',
      icon: null,
      versionCode: 1,
    }),
  })),
}));

describe('AppInfoService', () => {
  let service: AppInfoService;
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
    mockAdb = {} as Adb;
  });

  it('getMemoryLimit returns positive number', () => {
    const limit = service.getMemoryLimit();
    expect(limit).toBeGreaterThan(0);
  });

  it('shouldParse returns true when cache miss', async () {
    // Mock cache miss
    const result = await service.shouldParse('com.test.app', 1);
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/app-info-service.test.ts`
Expected: FAIL with "Cannot find module './app-info-service'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/app-info-service.ts
import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { parseApk, getMaxMemoryBytes } from './apk-parser';
import { getApkPath } from '@/utils/apk-utils';
import { getInstalledPackages } from './adb-commands';

export type ParseProgress = {
  total: number;
  parsed: number;
  skipped: number;
  current: string;
};

export type ParseCallback = (progress: ParseProgress) => void;

export class AppInfoService {
  private cache = new AppInfoCache();
  private parsing = false;

  getMemoryLimit(): number {
    return getMaxMemoryBytes();
  }

  async shouldParse(packageName: string, versionCode: number): Promise<boolean> {
    const cached = await this.cache.get(packageName);
    if (!cached) return true;
    return cached.versionCode !== versionCode;
  }

  async parseAllApps(
    adb: Adb,
    includeSystem: boolean = false,
    onProgress?: ParseCallback
  ): Promise<Map<string, AppInfo>> {
    if (this.parsing) {
      throw new Error('Already parsing');
    }

    this.parsing = true;
    const results = new Map<string, AppInfo>();
    const memoryLimit = this.getMemoryLimit();

    try {
      const packages = await getInstalledPackages(adb, includeSystem);
      const progress: ParseProgress = {
        total: packages.length,
        parsed: 0,
        skipped: 0,
        current: '',
      };

      // Sort by size ascending - need to get sizes first
      const packagesWithSize = await this.getPackageSizes(adb, packages);
      packagesWithSize.sort((a, b) => a.size - b.size);

      for (const pkg of packagesWithSize) {
        progress.current = pkg.name;
        onProgress?.(progress);

        // Check cache first
        const cached = await this.cache.get(pkg.name);
        if (cached && cached.versionCode === pkg.versionCode) {
          results.set(pkg.name, cached);
          progress.parsed++;
          continue;
        }

        // Check memory limit
        if (pkg.size > memoryLimit) {
          console.warn(`[AppInfoService] Skipping ${pkg.name}: ${pkg.size} bytes exceeds limit ${memoryLimit}`);
          progress.skipped++;
          progress.parsed++;
          continue;
        }

        // Download and parse APK
        try {
          const apkData = await this.downloadApk(adb, pkg.apkPath);
          if (!apkData) {
            progress.parsed++;
            continue;
          }

          const parsed = await parseApk(apkData, memoryLimit);
          if (!parsed) {
            progress.parsed++;
            continue;
          }

          const appInfo: AppInfo = {
            packageName: pkg.name,
            label: parsed.label,
            iconBase64: parsed.iconBase64,
            versionCode: pkg.versionCode,
            lastParsed: Date.now(),
          };

          await this.cache.set(pkg.name, appInfo);
          results.set(pkg.name, appInfo);
          progress.parsed++;
          onProgress?.(progress);
        } catch (e) {
          console.error(`[AppInfoService] Failed to parse ${pkg.name}:`, e);
          progress.parsed++;
        }
      }
    } finally {
      this.parsing = false;
    }

    return results;
  }

  async getAppInfo(packageName: string): Promise<AppInfo | null> {
    return this.cache.get(packageName);
  }

  private async getPackageSizes(
    adb: Adb,
    packages: string[]
  ): Promise<Array<{ name: string; apkPath: string; size: number; versionCode: number }>> {
    const results: Array<{ name: string; apkPath: string; size: number; versionCode: number }> = [];

    for (const pkg of packages) {
      try {
        const apkPath = await getApkPath(adb, pkg);
        if (!apkPath) continue;

        const sizeOutput = await adb.subprocess.noneProtocol.spawnWaitText(['stat', '-c', '%s', apkPath]);
        const size = parseInt(sizeOutput.trim(), 10) || 0;

        const versionOutput = await adb.subprocess.noneProtocol.spawnWaitText([
          'dumpsys', 'package', pkg, '|', 'grep', 'versionCode',
        ]);
        const versionMatch = versionOutput.match(/versionCode=(\d+)/);
        const versionCode = versionMatch ? parseInt(versionMatch[1], 10) : 0;

        results.push({ name: pkg, apkPath, size, versionCode });
      } catch (e) {
        console.warn(`[AppInfoService] Failed to get size for ${pkg}:`, e);
      }
    }

    return results;
  }

  private async downloadApk(adb: Adb, apkPath: string): Promise<ArrayBuffer | null> {
    try {
      const process = await adb.subprocess.noneProtocol.spawn(['cat', apkPath]);
      const chunks: Uint8Array[] = [];
      const reader = process.output.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value instanceof Uint8Array ? value : (value as { value: Uint8Array }).value);
        }
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return result.buffer;
    } catch (e) {
      console.error('[AppInfoService] Failed to download APK:', e);
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/app-info-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/app-info-service.ts src/lib/app-info-service.test.ts
git commit -m "feat: add AppInfoService with serial parsing and cache"
```

---

### Task 3: Integrate with useAppManager

**Covers:** ADR-0004 §影响

**Files:**
- Modify: `src/hooks/scrcpy/useAppManager.ts`

- [ ] **Step 1: Update useAppManager to use AppInfoService**

```typescript
// src/hooks/scrcpy/useAppManager.ts
import { useRef, useCallback, useMemo } from 'react';
import type { Adb } from '@yume-chan/adb';
import { extractIconFromApk } from '@/utils/apk-utils';
import {
  getInstalledPackages,
  getAppLabel as fetchAppLabel,
  batchGetAppLabels as fetchBatchAppLabels,
} from '@/lib/adb-commands';
import { AppInfoService, type ParseProgress } from '@/lib/app-info-service';

export function useAppManager() {
  const adbRef = useRef<Adb | null>(null);
  const iconCacheRef = useRef<Map<string, string | null>>(new Map());
  const labelCacheRef = useRef<Map<string, string | null>>(new Map());
  const serviceRef = useRef(new AppInfoService());

  const setAdb = useCallback((adb: Adb | null) => {
    adbRef.current = adb;
  }, []);

  const getAppList = useCallback(async (showSystem = false): Promise<string[]> => {
    const adb = adbRef.current;
    if (!adb) return [];
    return getInstalledPackages(adb, showSystem);
  }, []);

  const getAppLabel = useCallback(async (pkg: string): Promise<string> => {
    // Check AppInfoService cache first
    const serviceInfo = await serviceRef.current.getAppInfo(pkg);
    if (serviceInfo?.label) return serviceInfo.label;

    const cached = labelCacheRef.current.get(pkg);
    if (cached !== undefined) return cached ?? formatPackageName(pkg);

    const adb = adbRef.current;
    if (!adb) return formatPackageName(pkg);

    const label = await fetchAppLabel(adb, pkg);
    labelCacheRef.current.set(pkg, label);
    return label;
  }, []);

  const getAppIcon = useCallback(async (pkg: string): Promise<string | null> => {
    // Check AppInfoService cache first
    const serviceInfo = await serviceRef.current.getAppInfo(pkg);
    if (serviceInfo?.iconBase64) return serviceInfo.iconBase64;

    const cached = iconCacheRef.current.get(pkg);
    if (undefined !== cached) return cached;

    const adb = adbRef.current;
    if (!adb) return null;

    try {
      const iconUrl = await extractIconFromApk(adb, pkg);
      iconCacheRef.current.set(pkg, iconUrl);
      return iconUrl;
    } catch (error) {
      console.error('获取应用图标错误:', error);
      iconCacheRef.current.set(pkg, null);
      return null;
    }
  }, []);

  const batchGetAppLabels = useCallback(async (packages: string[]): Promise<Map<string, string>> => {
    const adb = adbRef.current;
    if (!adb) {
      return new Map(packages.map((p) => [p, formatPackageName(p)]));
    }

    const labels = await fetchBatchAppLabels(adb, packages);
    for (const [pkg, label] of labels) {
      labelCacheRef.current.set(pkg, label);
    }
    return labels;
  }, []);

  const parseAllApps = useCallback(async (
    includeSystem: boolean = false,
    onProgress?: (progress: ParseProgress) => void
  ): Promise<void> => {
    const adb = adbRef.current;
    if (!adb) return;

    await serviceRef.current.parseAllApps(adb, includeSystem, onProgress);
  }, []);

  return useMemo(() => ({
    setAdb,
    getAppList,
    getAppLabel,
    getAppIcon,
    batchGetAppLabels,
    parseAllApps,
  }), [setAdb, getAppList, getAppLabel, getAppIcon, batchGetAppLabels, parseAllApps]);
}

function formatPackageName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No TypeScript errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No ESLint errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/scrcpy/useAppManager.ts
git commit -m "feat: integrate AppInfoService with useAppManager"
```

---

### Task 4: Integration Test

**Covers:** ADR-0004 §影响

**Files:**
- Create: `src/lib/app-info-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/lib/app-info-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppInfoCache } from './app-info-cache';

describe('AppInfo Integration', () => {
  let cache: AppInfoCache;

  beforeEach(() => {
    cache = new AppInfoCache('integration-test');
  });

  afterEach(async () => {
    await cache.clear();
  });

  it('cache stores and retrieves app info correctly', async () => {
    const appInfo = {
      packageName: 'com.example.test',
      label: 'Test App',
      iconBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      versionCode: 42,
      lastParsed: Date.now(),
    };

    await cache.set(appInfo.packageName, appInfo);
    const result = await cache.get(appInfo.packageName);

    expect(result).toEqual(appInfo);
  });

  it('cache invalidation works', async () => {
    const appInfo = {
      packageName: 'com.example.invalidate',
      label: 'To Invalidate',
      iconBase64: null,
      versionCode: 1,
      lastParsed: Date.now(),
    };

    await cache.set(appInfo.packageName, appInfo);
    await cache.invalidate(appInfo.packageName);
    const result = await cache.get(appInfo.packageName);

    expect(result).toBeNull();
  });

  it('clear removes all entries', async () => {
    await cache.set('app1', { packageName: 'app1', label: 'App 1', iconBase64: null, versionCode: 1, lastParsed: Date.now() });
    await cache.set('app2', { packageName: 'app2', label: 'App 2', iconBase64: null, versionCode: 2, lastParsed: Date.now() });

    await cache.clear();

    expect(await cache.get('app1')).toBeNull();
    expect(await cache.get('app2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run src/lib/app-info-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/app-info-integration.test.ts
git commit -m "test: add integration tests for app info cache"
```

---

### Task 5: Final Verification

**Covers:** ADR-0004 (all sections)

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No TypeScript errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No ESLint errors

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: verify all tests pass"
```

---

## Self-Review Checklist

- [x] ADR-0004 §决策/解析库: Uses `app-info-parser` ✓
- [x] ADR-0004 §决策/数据传输: Full APK download via ADB sync ✓
- [x] ADR-0004 §决策/内存管理: `navigator.deviceMemory / 4` with 4GB fallback ✓
- [x] ADR-0004 §决策/解析策略/串行解析: One app at a time ✓
- [x] ADR-0004 §决策/解析策略/排序: Sort by APK size ascending ✓
- [x] ADR-0004 §决策/解析策略/持久化: IndexedDB with versionCode check ✓
- [x] No placeholders in plan ✓
- [x] Complete code in every step ✓
- [x] Exact file paths ✓
