import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Adb } from '@yume-chan/adb';
import { NowPlayingCard } from './NowPlayingCard';
import { AppGrid, type AppGridHandle } from './AppGrid';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';

export interface DesktopViewHandle {
  goToFirstPage: () => void;
}

interface DesktopViewProps {
  adb: Adb | null;
  onLaunchApp: (pkg: string) => void;
}

export const DesktopView = forwardRef<DesktopViewHandle, DesktopViewProps>(function DesktopView(
  { adb, onLaunchApp },
  ref,
) {
  const { media, estimatedPosition, control } = useMediaSession(adb);
  const { getAppIcon } = useScrcpyContext();
  const gridRef = useRef<AppGridHandle>(null);

  useImperativeHandle(ref, () => ({
    goToFirstPage: () => gridRef.current?.goToFirstPage(),
  }), []);

  return (
    <div className="w-full h-screen bg-slate-900 flex flex-col p-4 gap-4">
      {/* 音乐卡片（仅第 1 页可见，位于桌面顶部） */}
      <div className="shrink-0">
        <NowPlayingCard
          media={media}
          estimatedPosition={estimatedPosition}
          onControl={control}
          onLaunchApp={onLaunchApp}
          getAppIcon={getAppIcon}
        />
      </div>

      {/* 分页应用网格 */}
      <AppGrid ref={gridRef} onLaunchApp={onLaunchApp} />
    </div>
  );
});
