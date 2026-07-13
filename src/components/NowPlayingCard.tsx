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
  }, [media?.packageName, getAppIcon]);

  // 空状态：未在播放
  if (!media) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Music className="w-6 h-6 text-white/40" />
        </div>
        <div className="text-white/40 text-sm">未在播放</div>
      </div>
    );
  }

  const isPlaying = media.state === 'playing';
  const progress = media.duration > 0
    ? Math.min(100, (estimatedPosition / media.duration) * 100)
    : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
      {/* 图标占位（无真实封面）— 点击启动来源 app */}
      <button
        onClick={() => onLaunchApp(media.packageName)}
        className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/10 flex items-center justify-center"
        title={`打开 ${media.packageName}`}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Music className="w-6 h-6 text-white/40" />
        )}
      </button>

      {/* 歌曲信息 — 点击启动来源 app */}
      <button
        onClick={() => onLaunchApp(media.packageName)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-white text-sm font-medium truncate">
          {media.title || '未知曲目'}
        </div>
        <div className="text-white/50 text-xs truncate">
          {media.artist}{media.album ? ` · ${media.album}` : ''}
        </div>
      </button>

      {/* 控制按钮区 —— stopPropagation 不触发启动 */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onControl('previous')}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          title="上一首"
        >
          <SkipBack className="w-5 h-5 text-white/80" />
        </button>
        <button
          onClick={() => onControl('play-pause')}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying
            ? <Pause className="w-5 h-5 text-white" />
            : <Play className="w-5 h-5 text-white ml-0.5" />}
        </button>
        <button
          onClick={() => onControl('next')}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          title="下一首"
        >
          <SkipForward className="w-5 h-5 text-white/80" />
        </button>
      </div>

      {/* 进度条 */}
      <div className="hidden sm:flex flex-col items-end gap-0.5 w-20 shrink-0">
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-white/40 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {formatTime(estimatedPosition)} / {formatTime(media.duration)}
        </span>
      </div>
    </div>
  );
}
