import type { Adb } from '@yume-chan/adb';
import { runAdbCommand } from './adb-commands';
import { parseMediaSessionOutput, type MediaInfo } from './media-session-parser';

export type MediaKeyAction = 'play-pause' | 'next' | 'previous';

/**
 * Android keyevent 码映射（与媒体按键对应）。
 * play-pause=85 (KEYCODE_MEDIA_PLAY_PAUSE) / next=87 (KEYCODE_MEDIA_NEXT) /
 * previous=88 (KEYCODE_MEDIA_PREVIOUS)。
 */
const MEDIA_KEYEVENT: Record<MediaKeyAction, number> = {
  'play-pause': 85,
  next: 87,
  previous: 88,
};

/**
 * 查询当前正在播放的媒体会话。
 * 走 `dumpsys media_session`，交给 media-session-parser 解析首个活跃 session。
 * adb 不可用 / 命令失败时返回 null（UI 据此隐藏播放卡片）。
 */
export async function getMediaSession(adb: Adb): Promise<MediaInfo | null> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys media_session');
    return parseMediaSessionOutput(output);
  } catch {
    return null;
  }
}

/**
 * 派发媒体按键。
 * 主路径：`cmd media_session dispatch <action>`；
 * 主路径失败（老旧设备不支持）回退到 `input keyevent <code>`；
 * 两条路径都失败则静默忽略，不向上抛错（遥控器按键不应阻断 UI）。
 */
export async function dispatchMediaKey(adb: Adb, action: MediaKeyAction): Promise<void> {
  try {
    await runAdbCommand(adb, `cmd media_session dispatch ${action}`);
  } catch {
    try {
      const code = MEDIA_KEYEVENT[action];
      await runAdbCommand(adb, `input keyevent ${code}`);
    } catch {
      // 两条路径都失败，静默忽略
    }
  }
}
