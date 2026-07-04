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
      return { toParse: [], deviceApps: new Map() };
    }
    return serviceRef.current.syncWithDevice(adb, deviceSerial, signal);
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