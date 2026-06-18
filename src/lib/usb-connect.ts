import { RETRY_DELAYS, shouldRetry } from './usb-retry';

/** 单次连接尝试所用的依赖（注入以便测试）。 */
export interface RetryConnectDeps {
  /** 根据序列号重新枚举并返回当前可用的设备引用；找不到返回 null。 */
  findDevice: (serial: string) => Promise<unknown | null>;
  /** 在 connect 前恢复设备到干净状态（reset/close）。 */
  prepareDevice: (device: unknown) => Promise<void>;
  /** 真正执行一次 device.connect → authenticate → adb 建立。失败则 reject。 */
  connectOnce: (device: unknown) => Promise<void>;
  /** 可注入的 sleep，便于测试同步化。 */
  sleep: (ms: number) => Promise<void>;
  /** 外部取消探测；返回 true 时立即停止重试。 */
  isCancelled: () => boolean;
}

export interface RetryProgress {
  /** 本次是第几次尝试（从 1 开始）。 */
  attempt: number;
  /** 总尝试次数上限。 */
  total: number;
  /** 本次是否处于重试（attempt > 1）。 */
  retrying: boolean;
}

export interface RetryResult {
  success: boolean;
  cancelled?: boolean;
  /** 实际尝试了几次（设备找不到时为 0）。 */
  attempts: number;
}

/**
 * 按固定退避序列尝试连接 USB 设备。
 *
 * - 每轮先 `findDevice` 重新枚举（USB reset 会让旧引用失效）；
 * - 找不到设备直接失败，不重试；
 * - `connectOnce` 失败：致命错误立即停，瞬时/未知错误按 RETRY_DELAYS 退避后重试；
 * - 每轮开始前通过 `onProgress` 报告进度（供 UI 显示加载态）。
 */
export async function retryConnectUsb(
  serial: string,
  deps: RetryConnectDeps & { onProgress?: (p: RetryProgress) => void },
): Promise<RetryResult> {
  const total = RETRY_DELAYS.length;
  let attempts = 0;

  for (let i = 0; i < total; i++) {
    if (deps.isCancelled()) {
      return { success: false, cancelled: true, attempts };
    }

    // 退避等待（首次 i=0 时 delay=0，sleep(0) 不阻塞）
    const delay = RETRY_DELAYS[i];
    if (delay > 0) {
      await deps.sleep(delay);
    }

    if (deps.isCancelled()) {
      return { success: false, cancelled: true, attempts };
    }

    const device = await deps.findDevice(serial);
    if (!device) {
      return { success: false, attempts };
    }

    attempts += 1;
    deps.onProgress?.({ attempt: attempts, total, retrying: i > 0 });

    await deps.prepareDevice(device);

    try {
      await deps.connectOnce(device);
      return { success: true, attempts };
    } catch (error) {
      if (!shouldRetry(error)) {
        return { success: false, attempts };
      }
      // 继续下一轮
    }
  }

  return { success: false, attempts };
}
