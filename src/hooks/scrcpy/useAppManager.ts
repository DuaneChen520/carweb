import { useRef, useCallback, useMemo } from 'react';
import type { Adb } from '@yume-chan/adb';
import {
  getInstalledPackages,
  getAppLabel as fetchAppLabel,
  batchGetAppLabels as fetchBatchAppLabels,
} from '@/lib/adb-commands';
import { AppInfoService, type ParseProgress, type SyncResult } from '@/lib/app-info-service';
import { useAdbStore } from '@/hooks/useAdbStore';

export function useAppManager() {
  const adbRef = useRef<Adb | null>(null);
  const labelCacheRef = useRef<Map<string, string | null>>(new Map());
  const serviceRef = useRef(new AppInfoService());
  const deviceSerial = useAdbStore(s => s.deviceSerial);
  const prevSerialRef = useRef<string | null>(null);

  // 设备切换时清空内存缓存
  if (deviceSerial !== prevSerialRef.current) {
    labelCacheRef.current.clear();
    prevSerialRef.current = deviceSerial;
  }

  const setAdb = useCallback((adb: Adb | null) => {
    adbRef.current = adb;
  }, []);

  const getAppList = useCallback(async (showSystem = false): Promise<string[]> => {
    const adb = adbRef.current;
    if (!adb) return [];
    return getInstalledPackages(adb, showSystem);
  }, []);

  const getAppLabel = useCallback(async (pkg: string): Promise<string> => {
    if (!deviceSerial) return formatPackageName(pkg);

    const serviceInfo = await serviceRef.current.getAppInfo(deviceSerial, pkg);
    if (serviceInfo?.label) return serviceInfo.label;

    const cached = labelCacheRef.current.get(pkg);
    if (cached !== undefined) return cached ?? formatPackageName(pkg);

    const adb = adbRef.current;
    if (!adb) return formatPackageName(pkg);

    const label = await fetchAppLabel(adb, pkg);
    labelCacheRef.current.set(pkg, label);
    return label;
  }, [deviceSerial]);

  const getAppIcon = useCallback(async (pkg: string): Promise<string | null> => {
    if (!deviceSerial) return null;

    const serviceInfo = await serviceRef.current.getAppInfo(deviceSerial, pkg);
    if (serviceInfo?.iconBase64) {
      const icon = serviceInfo.iconBase64;
      return icon.startsWith('data:') ? icon : `data:image/png;base64,${icon}`;
    }
    return null;
  }, [deviceSerial]);

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
    onProgress?: (progress: ParseProgress) => void
  ): Promise<void> => {
    const adb = adbRef.current;
    if (!adb || !deviceSerial) return;

    await serviceRef.current.parseAllApps(adb, deviceSerial, onProgress);
    // 解析完成 → 列表/图标已写入应按 serial 索引的 store，通知 UI 重读。
    useAdbStore.getState().bumpAppListVersion();
  }, [deviceSerial]);

  const abortParseApps = useCallback(() => {
    serviceRef.current.abort();
  }, []);

  const getCachedAppLabels = useCallback(async (packages: string[]): Promise<Map<string, string>> => {
    const labels = new Map<string, string>();
    for (const pkg of packages) {
      const info = await serviceRef.current.getAppInfo(deviceSerial, pkg);
      labels.set(pkg, info?.label ?? formatPackageName(pkg));
    }
    return labels;
  }, [deviceSerial]);

  const clearAppInfoCache = useCallback(async (): Promise<void> => {
    await serviceRef.current.clearCache();
    labelCacheRef.current.clear();
  }, []);

  const getCacheInfo = useCallback(async (): Promise<{ count: number; size: number }> => {
    const [count, size] = await Promise.all([
      serviceRef.current.getCacheCount(),
      serviceRef.current.getCacheSize(),
    ]);
    return { count, size };
  }, []);

  const getAllCachedPackages = useCallback(async (): Promise<string[]> => {
    if (!deviceSerial) return [];
    const appInfos = await serviceRef.current.getCachedPackagesForDevice(deviceSerial);
    return appInfos.map(info => info.packageName);
  }, [deviceSerial]);

  const syncWithDevice = useCallback(async (signal?: AbortSignal): Promise<SyncResult> => {
    const adb = adbRef.current;
    if (!adb || !deviceSerial) {
      console.warn('[AppManager] syncWithDevice 跳过：adb 或 deviceSerial 为空（重连不会拉取）', {
        hasAdb: !!adb,
        deviceSerial,
      });
      return { toParse: [], deviceApps: new Map() };
    }
    console.log(`[AppManager] 开始设备应用列表同步（serial=${deviceSerial}）`);
    const result = await serviceRef.current.syncWithDevice(adb, deviceSerial, signal);
    // 注意：此处不再无条件 bump。syncWithDevice 是底层操作，其调用方（reloadSidebarApps
    // 的恢复分支、syncAndParseIfNeeded 内部）各自负责在「真实写入」后通知 UI，避免与
    // appListVersion 自愈副作用形成「同步→bump→再同步」死循环。
    return result;
  }, [deviceSerial]);

  const syncAndParseIfNeeded = useCallback(async (signal?: AbortSignal): Promise<SyncResult> => {
    const adb = adbRef.current;
    if (!adb || !deviceSerial) {
      console.warn('[AppManager] syncAndParseIfNeeded 跳过：adb 或 deviceSerial 为空（重连不会拉取）', {
        hasAdb: !!adb,
        deviceSerial,
      });
      return { toParse: [], deviceApps: new Map() };
    }
    console.log(`[AppManager] 连接/重连触发应用列表同步与按需解析（serial=${deviceSerial}）`);
    const result = await serviceRef.current.syncAndParseIfNeeded(adb, deviceSerial, signal);
    console.log(
      `[AppManager] 同步结果：设备 ${result.deviceApps.size} 个应用，需解析 ${result.toParse.length} 个`
      + (result.toParse.length > 0 ? ' → 执行全量 dex 解析' : ' → 缓存命中，无需重拉'),
    );
    // syncAndParseIfNeeded 内部已写 store（及按需 parseAllApps），通知 UI 重读；
    // skip 路径（重入守卫命中）未产生任何写入，不通知，避免无谓重渲染/死循环。
    if (!result.skipped) {
      useAdbStore.getState().bumpAppListVersion();
    }
    return result;
  }, [deviceSerial]);

  const getAllDeviceApps = useCallback(async () => {
    if (!deviceSerial) return [];
    return serviceRef.current.getAllDeviceApps(deviceSerial);
  }, [deviceSerial]);

  const incrementLocalCount = useCallback(async (pkg: string): Promise<void> => {
    if (!deviceSerial) return;
    await serviceRef.current.incrementLocalCount(deviceSerial, pkg);
  }, [deviceSerial]);

  const togglePin = useCallback(async (pkg: string): Promise<boolean> => {
    if (!deviceSerial) return false;
    return serviceRef.current.togglePin(deviceSerial, pkg);
  }, [deviceSerial]);

  const getPinnedApps = useCallback(async () => {
    if (!deviceSerial) return [];
    return serviceRef.current.getPinnedApps(deviceSerial);
  }, [deviceSerial]);

  const clearDeviceApps = useCallback(async (): Promise<void> => {
    await serviceRef.current.clearDeviceApps();
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    await serviceRef.current.clearAll();
    labelCacheRef.current.clear();
  }, []);

  // --- 新增按设备清理方法 ---

  const clearDeviceAppCache = useCallback(async (serial: string): Promise<void> => {
    await serviceRef.current.clearDeviceAppCache(serial);
    labelCacheRef.current.clear();
  }, []);

  const clearDevicePreferences = useCallback(async (serial: string): Promise<void> => {
    await serviceRef.current.clearDevicePreferences(serial);
  }, []);

  const getDeviceCacheInfo = useCallback(async (serial: string) => {
    return serviceRef.current.getDeviceCacheInfo(serial);
  }, []);

  const getAllDeviceSerials = useCallback(async () => {
    return serviceRef.current.getAllDeviceSerials();
  }, []);

  return useMemo(() => ({
    setAdb,
    getAppList,
    getAppLabel,
    getAppIcon,
    batchGetAppLabels,
    parseAllApps,
    abortParseApps,
    getCachedAppLabels,
    getAllCachedPackages,
    clearAppInfoCache,
    getCacheInfo,
    syncWithDevice,
    syncAndParseIfNeeded,
    getAllDeviceApps,
    incrementLocalCount,
    togglePin,
    getPinnedApps,
    clearDeviceApps,
    clearAll,
    clearDeviceAppCache,
    clearDevicePreferences,
    getDeviceCacheInfo,
    getAllDeviceSerials,
  }), [
    setAdb,
    getAppList,
    getAppLabel,
    getAppIcon,
    batchGetAppLabels,
    parseAllApps,
    abortParseApps,
    getCachedAppLabels,
    getAllCachedPackages,
    clearAppInfoCache,
    getCacheInfo,
    syncWithDevice,
    syncAndParseIfNeeded,
    getAllDeviceApps,
    incrementLocalCount,
    togglePin,
    getPinnedApps,
    clearDeviceApps,
    clearAll,
    clearDeviceAppCache,
    clearDevicePreferences,
    getDeviceCacheInfo,
    getAllDeviceSerials,
  ]);
}

function formatPackageName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}