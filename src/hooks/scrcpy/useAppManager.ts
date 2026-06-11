import { useRef, useCallback, useMemo } from 'react';
import type { Adb } from '@yume-chan/adb';
import { extractIconFromApk } from '@/utils/apk-utils';
import {
  getInstalledPackages,
  getAppLabel as fetchAppLabel,
  batchGetAppLabels as fetchBatchAppLabels,
} from '@/lib/adb-commands';

export function useAppManager() {
  const adbRef = useRef<Adb | null>(null);
  const iconCacheRef = useRef<Map<string, string | null>>(new Map());
  const labelCacheRef = useRef<Map<string, string | null>>(new Map());

  const setAdb = useCallback((adb: Adb | null) => {
    adbRef.current = adb;
  }, []);

  const getAppList = useCallback(async (showSystem = false): Promise<string[]> => {
    const adb = adbRef.current;
    if (!adb) return [];
    return getInstalledPackages(adb, showSystem);
  }, []);

  const getAppLabel = useCallback(async (pkg: string): Promise<string> => {
    const cached = labelCacheRef.current.get(pkg);
    if (cached !== undefined) return cached ?? formatPackageName(pkg);

    const adb = adbRef.current;
    if (!adb) return formatPackageName(pkg);

    const label = await fetchAppLabel(adb, pkg);
    labelCacheRef.current.set(pkg, label);
    return label;
  }, []);

  const getAppIcon = useCallback(async (pkg: string): Promise<string | null> => {
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

  return useMemo(() => ({
    setAdb,
    getAppList,
    getAppLabel,
    getAppIcon,
    batchGetAppLabels,
  }), [setAdb, getAppList, getAppLabel, getAppIcon, batchGetAppLabels]);
}

function formatPackageName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
