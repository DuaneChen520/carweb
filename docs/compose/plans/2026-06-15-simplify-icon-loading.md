# Simplify Icon Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser-side APK parsing fallback, make DEX the sole icon source, and show first-letter placeholders until DEX completes.

**Architecture:** Simplify `getAppIcon` to only read from IndexedDB cache (DEX results). Remove `extractIconFromApk` fallback. Remove `parseAllAppsViaBrowser` and its helpers. UI shows first-letter placeholders during DEX execution, then silently upgrades to real icons.

**Tech Stack:** TypeScript, React, IndexedDB, ya-webadb, DeviceAppParser (DEX)

---

### Task 1: Simplify `getAppIcon` — cache-only, no APK fallback

**Files:**
- Modify: `src/hooks/scrcpy/useAppManager.ts:1-64`

- [ ] **Step 1: Remove `extractIconFromApk` import and `iconCacheRef`**

In `src/hooks/scrcpy/useAppManager.ts`, remove line 3 (`import { extractIconFromApk }`) and line 13 (`const iconCacheRef = useRef<Map<string, string | null>>(new Map())`).

- [ ] **Step 2: Simplify `getAppIcon` to cache-only**

Replace the `getAppIcon` callback (lines 42-64) with:

```typescript
const getAppIcon = useCallback(async (pkg: string): Promise<string | null> => {
  const serviceInfo = await serviceRef.current.getAppInfo(pkg);
  if (serviceInfo?.iconBase64) {
    const icon = serviceInfo.iconBase64;
    return icon.startsWith('data:') ? icon : `data:image/png;base64,${icon}`;
  }
  return null;
}, []);
```

- [ ] **Step 3: Remove `iconCacheRef` from `clearAppInfoCache`**

In `clearAppInfoCache` (lines 102-106), remove the line `iconCacheRef.current.clear();`.

- [ ] **Step 4: Run typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/scrcpy/useAppManager.ts
git commit -m "refactor: simplify getAppIcon to cache-only, remove APK extraction fallback"
```

---

### Task 2: Remove browser-side APK parsing from `AppInfoService`

**Files:**
- Modify: `src/lib/app-info-service.ts:1-278`

- [ ] **Step 1: Remove unused imports**

Remove line 3 (`import { parseApk, getMaxMemoryBytes } from './apk-parser'`) and line 4 (`import { getInstalledPackages, runAdbCommand } from './adb-commands'`).

- [ ] **Step 2: Remove `getMemoryLimit` method**

Delete the `getMemoryLimit()` method (lines 22-24).

- [ ] **Step 3: Remove `shouldParse` method**

Delete the `shouldParse()` method (lines 26-30). It is unused — `parseAllApps` does its own cache checks.

- [ ] **Step 4: Remove browser fallback in `parseAllApps`**

In `parseAllApps`, replace the `catch` block (lines 98-101):

```typescript
} catch (error) {
  // Device parser failed, fallback to browser-side parsing
  console.warn('[AppInfoService] 设备端解析失败，回退到浏览器端解析:', error);
  return this.parseAllAppsViaBrowser(adb, includeSystem, signal, onProgress);
}
```

with:

```typescript
} catch (error) {
  console.error('[AppInfoService] 设备端解析失败:', error);
  throw error;
}
```

- [ ] **Step 5: Delete `parseAllAppsViaBrowser` method**

Delete the entire `parseAllAppsViaBrowser` private method (lines 108-196).

- [ ] **Step 6: Delete `getPackageSizes` method**

Delete the entire `getPackageSizes` private method (lines 214-248).

- [ ] **Step 7: Delete `downloadApk` method**

Delete the entire `downloadApk` private method (lines 250-277).

- [ ] **Step 8: Run typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/app-info-service.ts
git commit -m "refactor: remove browser-side APK parsing fallback from AppInfoService"
```

---

### Task 3: Clean up unused `apk-parser.ts` imports

**Files:**
- Check: `src/lib/app-info-service.ts` (should no longer import from apk-parser)
- Check: any other files importing `parseApk` or `getMaxMemoryBytes`

- [ ] **Step 1: Verify no remaining imports of apk-parser**

Run: `grep -r "apk-parser" src/ --include="*.ts" --include="*.tsx"`
Expected: Only `apk-parser.ts` itself and its test file. No imports from other files.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: PASS

---

### Task 4: Verify UI shows placeholders correctly

**Files:**
- Check: `src/components/ControlSidebar.tsx:77-86`

- [ ] **Step 1: Confirm `AppIcon` renders first-letter placeholder when `iconUrl` is null**

In `ControlSidebar.tsx` lines 77-86, the component already renders a colored first-letter `<div>` when `iconUrl` is null. No code changes needed — this is the existing behavior.

- [ ] **Step 2: Manual test**

1. Open browser, clear IndexedDB (DevTools → Application → IndexedDB → delete `app-info-cache`)
2. Reload page, connect device
3. Open app panel → should show first-letter placeholders immediately
4. Wait for DEX parsing to complete (~8s) → icons should silently replace placeholders
5. Close and reopen panel → icons should appear immediately from cache

---

### Task 5: Commit documentation of removed approach

**Files:**
- Create: `docs/adr/0005-remove-browser-side-apk-parsing.md`

- [ ] **Step 1: Write ADR**

```markdown
# ADR-0005: Remove Browser-Side APK Parsing

## Status
Accepted

## Context
The app had three icon/label extraction paths:
1. Quick ADB label extraction (`batchGetAppLabels`) — fast, labels only
2. Device-side DEX parser (`DeviceAppParser`) — ~8s, high-quality icons+labels
3. Browser-side APK parsing (`parseAllAppsViaBrowser`) — slow, downloads APKs

Path 3 was a fallback when path 2 failed. It caused "blurry icon flash" because:
- First render used `extractIconFromApk` (low-quality blob URL from APK)
- After DEX completed, icons silently upgraded to high-quality data URIs

## Decision
Remove path 3 entirely. DEX is the sole icon/label source.

- `getAppIcon` reads only from IndexedDB cache (DEX results)
- `batchGetAppLabels` provides fast labels during DEX execution
- UI shows first-letter placeholders until DEX completes

## Consequences
- Simpler codebase (~100 lines removed)
- No more blurry icon flash
- If DEX fails, users see placeholders instead of low-quality icons
- `apk-parser.ts` retained for potential future use but unused at runtime
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0005-remove-browser-side-apk-parsing.md
git commit -m "docs: ADR for removing browser-side APK parsing"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run all checks**

```bash
npm run check && npm run lint && npm run test
```

Expected: All pass (test failures in `device-app-parser.test.ts` are pre-existing mock issues)

- [ ] **Step 2: Final commit if needed**

If any fixes were required during verification, commit them.
