import { useRef, useCallback, useMemo } from 'react';
import { UserPreferencesStore } from '@/lib/user-preferences-store';
import { useAdbStore } from './useAdbStore';
import type { LaunchCountData } from '@/lib/app-sorter';
import { sortApps } from '@/lib/app-sorter';

export function useAppPreferences() {
  const storeRef = useRef(new UserPreferencesStore());
  const deviceSerial = useAdbStore(s => s.deviceSerial);

  const getPinnedApps = useCallback(async (): Promise<string[]> => {
    if (!deviceSerial) return [];
    const records = await storeRef.current.getPinned(deviceSerial);
    return records.map(r => r.packageName);
  }, [deviceSerial]);

  const togglePin = useCallback(async (pkg: string): Promise<boolean> => {
    if (!deviceSerial) return false;
    return storeRef.current.togglePinned(deviceSerial, pkg);
  }, [deviceSerial]);

  const incrementLaunchCount = useCallback(async (pkg: string): Promise<void> => {
    if (!deviceSerial) return;
    await storeRef.current.incrementLaunchCount(deviceSerial, pkg);
  }, [deviceSerial]);

  const getSortedApps = useCallback(async (allPackages: string[]): Promise<string[]> => {
    if (!deviceSerial) return allPackages;
    const [pinnedRecords, launchCounts] = await Promise.all([
      storeRef.current.getPinned(deviceSerial),
      storeRef.current.getLaunchCounts(deviceSerial),
    ]);

    const pinnedMap = new Map<string, number>(
      pinnedRecords.map(r => [r.packageName, r.order]),
    );

    return sortApps(
      allPackages,
      pinnedMap,
      launchCounts as unknown as Map<string, LaunchCountData>,
    );
  }, [deviceSerial]);

  const bulkSetDexBaseline = useCallback(async (entries: [string, number][]): Promise<void> => {
    if (!deviceSerial) return;
    await storeRef.current.bulkSetDexBaseline(deviceSerial, entries);
  }, [deviceSerial]);

  const clearUsageData = useCallback(async (): Promise<void> => {
    if (!deviceSerial) return;
    await Promise.all([
      storeRef.current.clearPinned(deviceSerial),
      storeRef.current.clearLocalCounts(deviceSerial),
    ]);
  }, [deviceSerial]);

  return useMemo(() => ({
    getPinnedApps,
    togglePin,
    incrementLaunchCount,
    getSortedApps,
    bulkSetDexBaseline,
    clearUsageData,
  }), [
    getPinnedApps,
    togglePin,
    incrementLaunchCount,
    getSortedApps,
    bulkSetDexBaseline,
    clearUsageData,
  ]);
}
