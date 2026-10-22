import { useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music } from 'lucide-react';
import type { MediaInfo } from '@/lib/media-session-parser';

interface NowPlayingCardProps {
  media: MediaInfo | null;
  estimatedPosition: number;
  onControl: (action: 'play-pause' | 'next' | 'previous') => void;
  onLaunchApp: (pkg: string) => void;
  getAppIcon: (pkg: string) => Promise<string | null>;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function NowPlayingCard({ media, estimatedPosition, onControl, onLaunchApp, getAppIcon }: NowPlayingCardProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!media) { setIconUrl(null); return; }
    let cancelled = false;
    getAppIcon(media.packageName).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [media, getAppIcon]);

  // 空状态：未在播放
  if (!media) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card/90 backdrop-blur-md border border-surface-elevated/40 shadow-card">
        <div className="w-12 h-12 rounded-xl bg-surface-elevated/50 flex items-center justify-center shrink-0">
          <Music className="w-6 h-6 text-content-muted" />
        </div>
        <div className="text-content-muted text-sm font-medium">未在播放</div>
      </div>
    );
  }

  const isPlaying = media.state === 'playing';
  const progress = media.duration > 0
    ? Math.min(100, (estimatedPosition / media.duration) * 100)
    : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card/90 backdrop-blur-md border border-surface-elevated/40 shadow-card select-none">
      {/* 图标占位（无真实封面）— 点击启动来源 app */}
      <button
        type="button"
        onClick={() => onLaunchApp(media.packageName)}
        className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-surface-elevated/60 hover:bg-surface-hover/80 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
        title={`打开 ${media.packageName}`}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Music className="w-6 h-6 text-content-muted" />
        )}
      </button>

      {/* 歌曲信息 — 点击启动来源 app */}
      <button
        type="button"
        onClick={() => onLaunchApp(media.packageName)}
        className="flex-1 min-w-0 text-left cursor-pointer"
      >
        <div className="text-content-primary text-sm font-medium truncate">
          {media.title || '未知曲目'}
        </div>
        <div className="text-content-secondary text-xs truncate">
          {media.artist}{media.album ? ` · ${media.album}` : ''}
        </div>
      </button>

      {/* 控制按钮区 —— stopPropagation 不触发启动 */}
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onControl('previous')}
          className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover/80 text-content-secondary hover:text-content-primary transition-all active:scale-95 cursor-pointer"
          title="上一首"
        >
          <SkipBack className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onControl('play-pause')}
          className="w-12 h-12 flex items-center justify-center rounded-xl bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 active:scale-95 transition-all shadow-accent-glow cursor-pointer"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying
            ? <Pause className="w-5 h-5" />
            : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => onControl('next')}
          className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover/80 text-content-secondary hover:text-content-primary transition-all active:scale-95 cursor-pointer"
          title="下一首"
        >
          <SkipForward className="w-5 h-5" />
        </button>
      </div>

      {/* 进度条 */}
      <div className="hidden sm:flex flex-col items-end gap-1 w-24 shrink-0">
        <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
          <div className="h-full bg-accent-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-content-muted font-mono tabular-nums">
          {formatTime(estimatedPosition)} / {formatTime(media.duration)}
        </span>
      </div>
    </div>
  );
}
