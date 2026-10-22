import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { useScrcpyActions } from '@/contexts/ScrcpyContext';
import { useAdbStore } from '@/hooks/useAdbStore';
import { sortApps } from '@/lib/app-sorter';
import { paginateApps } from '@/lib/app-pagination';
import type { DeviceAppRecord } from '@/lib/device-apps-store';

export interface AppGridHandle {
  goToFirstPage: () => void;
  /** force=true 时先跑全量设备端重解析（parseAllApps），再重读列表；否则仅重读缓存。 */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
}

interface AppGridProps {
  onLaunchApp: (pkg: string) => void;
  /** 搜索过滤（匹配包名或已缓存标签），可选 */
  searchText?: string;
  /** 置顶模式：开启后点击应用 = 切换置顶而非启动 */
  pinMode?: boolean;
  /** 置顶模式下的切换回调 */
  onTogglePin?: (pkg: string) => void;
}

const COLS = 4;

export const AppGrid = forwardRef<AppGridHandle, AppGridProps>(function AppGrid(
  { onLaunchApp, searchText, pinMode, onTogglePin },
  ref,
) {
  const { getAllDeviceApps, getAppIcon, getCachedAppLabels, incrementLocalCount, parseAllApps } = useScrcpyActions();
  const appListVersion = useAdbStore((s) => s.appListVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [deviceApps, setDeviceApps] = useState<DeviceAppRecord[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  // 拉取应用列表
  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    // 手动刷新：先全量重解析设备端应用元数据（清空数据/缓存失效后的恢复路径）。
    if (opts?.force) {
      try {
        await parseAllApps();
      } catch (e) {
        console.warn('[AppGrid] 全量重解析失败（将回退到缓存）:', e);
      }
    }
    const apps = await getAllDeviceApps();
    setDeviceApps(apps);
    const pkgs = apps.map((a) => a.packageName);
    const labelMap = await getCachedAppLabels(pkgs);
    setLabels(labelMap);
  }, [getAllDeviceApps, getCachedAppLabels, parseAllApps]);

  useEffect(() => {
    refresh();
  }, [refresh, appListVersion]);

  // 搜索关键字防抖（150ms），避免键盘连续敲击高频重算过滤
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery((searchText ?? '').toLowerCase().trim());
    }, 150);
    return () => clearTimeout(timer);
  }, [searchText]);

  // 用 sortApps 做三段排序（置顶>常用>其他），使用 useMemo 缓存避免无关渲染重计算
  const { sortedPkgs, pinnedMap } = useMemo(() => {
    const allPkgs = deviceApps.map((a) => a.packageName);
    const pinned = new Map<string, number>();
    const counts = new Map<string, { localCount: number; dexBaseline: number }>();
    const pMap = new Map<string, boolean>();
    for (const a of deviceApps) {
      if (a.pinned) pinned.set(a.packageName, a.pinOrder);
      counts.set(a.packageName, { localCount: a.localCount, dexBaseline: a.launchCount });
      pMap.set(a.packageName, a.pinned);
    }
    return {
      sortedPkgs: sortApps(allPkgs, pinned, counts),
      pinnedMap: pMap,
    };
  }, [deviceApps]);

  // 搜索过滤（包名或已缓存标签），使用防抖后的 query 与 useMemo 隔离
  const filteredPkgs = useMemo(() => {
    if (!debouncedQuery) return sortedPkgs;
    return sortedPkgs.filter((pkg) => {
      if (pkg.toLowerCase().includes(debouncedQuery)) return true;
      const label = labels.get(pkg) || '';
      return label.toLowerCase().includes(debouncedQuery);
    });
  }, [sortedPkgs, debouncedQuery, labels]);

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

  const pages = paginateApps(filteredPkgs, perPage);

  const handleLaunch = useCallback((pkg: string) => {
    if (pinMode && onTogglePin) {
      onTogglePin(pkg);
      return;
    }
    incrementLocalCount(pkg).then(() => refresh()).catch(() => {});
    onLaunchApp(pkg);
  }, [pinMode, onTogglePin, incrementLocalCount, refresh, onLaunchApp]);

  // 暴露回第一页 + 手动刷新
  useImperativeHandle(ref, () => ({
    goToFirstPage: () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    },
    refresh: async (opts?: { force?: boolean }) => {
      await refresh(opts);
    },
  }), [refresh]);

  if (deviceApps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-content-secondary text-sm py-12">
        正在加载应用列表...
      </div>
    );
  }

  if (filteredPkgs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-content-secondary text-sm py-12">
        无匹配应用
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
                  name={labels.get(pkg) || pkg}
                  getAppIcon={getAppIcon}
                  onLaunch={handleLaunch}
                  pinMode={pinMode}
                  isPinned={pinnedMap.get(pkg) ?? false}
                  cacheVersion={appListVersion}
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
              className="w-1.5 h-1.5 rounded-full bg-content-muted/30"
            />
          ))}
        </div>
      )}
    </div>
  );
});
