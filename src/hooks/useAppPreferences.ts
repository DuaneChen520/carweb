import { useRef, useCallback, useMemo } from 'react';
import { UserPreferencesStore } from '@/lib/user-preferences-store';
import type { LaunchCountData } from '@/lib/app-sorter';
import { sortApps } from '@/lib/app-sorter';

export function useAppPreferences() {
  const storeRef = useRef(new UserPreferencesStore());

  const getPinnedApps = useCallback(async (): Promise<string[]> => {
    const records = await storeRef.current.getPinned();
    return records.map(r => r.packageName);
  }, []);

  const togglePin = useCallback(async (pkg: string): Promise<boolean> => {
    return storeRef.current.togglePinned(pkg);
  }, []);

  const incrementLaunchCount = useCallback(async (pkg: string): Promise<void> => {
    await storeRef.current.incrementLaunchCount(pkg);
  }, []);

  const getSortedApps = useCallback(async (allPackages: string[]): Promise<string[]> => {
    const [pinnedRecords, launchCounts] = await Promise.all([
      storeRef.current.getPinned(),
      storeRef.current.getLaunchCounts(),
    ]);

    const pinnedMap = new Map<string, number>(
      pinnedRecords.map(r => [r.packageName, r.order]),
    );

    return sortApps(
      allPackages,
      pinnedMap,
      launchCounts as unknown as Map<string, LaunchCountData>,
    );
  }, []);

  const bulkSetDexBaseline = useCallback(async (entries: [string, number][]): Promise<void> => {
    await storeRef.current.bulkSetDexBaseline(entries);
  }, []);

  const clearUsageData = useCallback(async (): Promise<void> => {
    await Promise.all([
      storeRef.current.clearPinned(),
      storeRef.current.clearLocalCounts(),
    ]);
  }, []);

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
