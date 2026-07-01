import { useEffect, useRef, useState, useCallback } from 'react';
import type { Adb } from '@yume-chan/adb';
import { getMediaSession, dispatchMediaKey, type MediaInfo } from '@/lib/adb-commands';

export interface UseMediaSessionResult {
  media: MediaInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  control: (action: 'play-pause' | 'next' | 'previous') => Promise<void>;
  estimatedPosition: number;
}

const POLL_INTERVAL = 5000; // 5 秒轮询

export function useMediaSession(adb: Adb | null): UseMediaSessionResult {
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // 进度外推：记录快照时刻 + position
  const snapshotRef = useRef<{ position: number; timestamp: number } | null>(null);
  const [estimatedPosition, setEstimatedPosition] = useState(0);

  const refresh = useCallback(async () => {
    if (!adb) {
      setMedia(null);
      return;
    }
    setLoading(true);
    try {
      const info = await getMediaSession(adb);
      setMedia(info);
      if (info) {
        snapshotRef.current = { position: info.position, timestamp: Date.now() };
        setEstimatedPosition(info.position);
      } else {
        snapshotRef.current = null;
        setEstimatedPosition(0);
      }
    } catch {
      setMedia(null);
    } finally {
      setLoading(false);
    }
  }, [adb]);

  // 挂载 + adb 变化时立即拉一次，然后起 5s 轮询
  useEffect(() => {
    refresh();
    if (!adb) return;
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [adb, refresh]);

  // 进度外推：每秒根据 playing 状态推进
  useEffect(() => {
    if (!media || media.state !== 'playing') return;
    const snap = snapshotRef.current;
    if (!snap) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - snap.timestamp;
      setEstimatedPosition(snap.position + elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [media]);

  const control = useCallback(async (action: 'play-pause' | 'next' | 'previous') => {
    if (!adb) return;
    await dispatchMediaKey(adb, action);
    // 控制后立即刷新，保证 UI 即时反馈
    await refresh();
  }, [adb, refresh]);

  return { media, loading, refresh, control, estimatedPosition };
}
