/**
 * 把 USB 设备恢复到干净状态，优先做总线级 reset。
 *
 * 页面刷新后接口常处于"半开"，对已异常的接口调 close 通常无效；
 * reset 是 USB 级别硬复位，更彻底，重置后给设备 ~250ms 重新枚举。
 */

export interface RestorableDevice {
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

const DEFAULT_STABILIZE_MS = 250;

export async function restoreDevice(
  device: RestorableDevice,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  stabilizeMs: number = DEFAULT_STABILIZE_MS,
): Promise<void> {
  try {
    await device.reset();
    await sleep(stabilizeMs);
  } catch {
    try { await device.close(); } catch { /* 静默：两个都失败也交给上层重试 */ }
  }
}
