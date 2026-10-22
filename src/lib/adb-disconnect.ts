import type { Adb } from '@yume-chan/adb';
import type { AdbStore } from '../hooks/useAdbStore';
import { consumeIntentionalClose } from './adb-intent';

/**
 * `adb.disconnected` 的统一定点处理（同时满足正常 resolve 与异常 reject 两个分支）。
 *
 * 行为：
 * - 有意断开（`consumeIntentionalClose` 为真）：仅清理引用并置 `idle`，
 *   **不写 `disconnected`、不写 error** —— 避免 `App.tsx` 误判为「使用中真掉线」弹 overlay。
 * - 真实掉线（未标记）：
 *   - 正常 resolve → 置 `disconnected`（由 `App.tsx` 正常弹出重连 overlay）；
 *   - 异常 reject（带 error）→ 置 `disconnected` + error（真实传输层断开）。
 *
 * 该函数被抽离以便单测（见 __tests__/adb-disconnect.test.ts）。
 */
export function handleAdbDisconnected(store: AdbStore, adb: Adb, error?: unknown): void {
  const intentional = consumeIntentionalClose(adb);
  const isWifi = store.connectionType === 'wifi';
  const tag = isWifi ? '[WiFi]' : '[USB]';

  // 先清空 adb/设备引用，再置 status：避免「adb 仍非空但连接已死」的窗口，
  // 防止上层在死连接上启动 scrcpy（AdbScrcpyExitedError）。见 2026-07-09 诊断。
  store.setAdb(null);
  store.setUsbDevice(null);
  store.setDeviceInfo(null, null);

  if (intentional) {
    store.setConnectionStatus('idle');
    return;
  }

  if (error !== undefined) {
    const errMsg = (error as Error)?.message || String(error);
    console.warn(`${tag} adb.disconnected rejected — 异常断开:`, errMsg);

    if (isWifi) {
      if (/unauthorized|auth|permission/i.test(errMsg)) {
        store.setError('手机端无线调试授权已失效或关闭');
      } else {
        store.setError('WiFi 信号较弱或网络暂时中断');
      }
    } else {
      store.setError('USB 连接异常断开');
    }
  } else {
    console.log(`${tag} adb.disconnected resolved — 正常断开`);
  }

  store.setConnectionStatus('disconnected');
}
