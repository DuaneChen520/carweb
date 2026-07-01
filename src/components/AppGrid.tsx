import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';
import { sortApps } from '@/lib/app-sorter';
import { paginateApps } from '@/lib/app-pagination';
import type { DeviceAppRecord } from '@/lib/device-apps-store';

export interface AppGridHandle {
  goToFirstPage: () => void;
}

interface AppGridProps {
  onLaunchApp: (pkg: string) => void;
}

const COLS = 4;

export const AppGrid = forwardRef<AppGridHandle, AppGridProps>(function AppGrid(
  { onLaunchApp },
  ref,
) {
  const scrcpy = useScrcpyContext();
  const { getAllDeviceApps, getAppIcon, getCachedAppLabels, incrementLocalCount } = scrcpy;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [deviceApps, setDeviceApps] = useState<DeviceAppRecord[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  // 拉取应用列表
  const refresh = useCallback(async () => {
    const apps = await getAllDeviceApps();
    setDeviceApps(apps);
    const pkgs = apps.map((a) => a.packageName);
    const labelMap = await getCachedAppLabels(pkgs);
    setLabels(labelMap);
  }, [getAllDeviceApps, getCachedAppLabels]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 用 sortApps 做三段排序（置顶>常用>其他）
  const allPkgs = deviceApps.map((a) => a.packageName);
  const pinned = new Map<string, number>();
  const counts = new Map<string, { localCount: number; dexBaseline: number }>();
  for (const a of deviceApps) {
    if (a.pinned) pinned.set(a.packageName, a.pinOrder);
    counts.set(a.packageName, { localCount: a.localCount, dexBaseline: a.launchCount });
  }
  const sortedPkgs = sortApps(allPkgs, pinned, counts);

  // 计算每页容量（4 列 × 行数）
  const [perPage, setPerPage] = useState(12);
  useEffect(() => {
    const calc = () => {
      const rows = Math.max(2, Math.floor((window.innerHeight - 240) / 110));
      setPerPage(COLS * rows);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  const pages = paginateApps(sortedPkgs, perPage);

  const handleLaunch = useCallback((pkg: string) => {
    incrementLocalCount(pkg).then(() => refresh()).catch(() => {});
    onLaunchApp(pkg);
  }, [incrementLocalCount, refresh, onLaunchApp]);

  // 暴露回第一页
  useImperativeHandle(ref, () => ({
    goToFirstPage: () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    },
  }), []);

  if (deviceApps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 text-sm py-12">
        正在加载应用列表...
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="h-full overflow-x-auto overflow-y-hidden flex snap-x snap-mandatory scrollbar-none"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {pages.map((pageApps, pageIdx) => (
          <div
            key={pageIdx}
            className="w-full shrink-0 snap-start px-6 py-4"
            style={{ scrollSnapAlign: 'start' }}
          >
            <div
              className="grid gap-x-4 gap-y-5"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
            >
              {pageApps.map((pkg) => (
                <AppIcon
                  key={pkg}
                  pkg={pkg}
                  name={labels.get(pkg) || pkg.split('.').pop() || pkg}
                  getAppIcon={getAppIcon}
                  onLaunch={handleLaunch}
                  cacheVersion={0}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 页面指示器 */}
      {pages.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2">
          {pages.map((_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-white/20"
            />
          ))}
        </div>
      )}
    </div>
  );
});
