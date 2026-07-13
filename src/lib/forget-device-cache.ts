import { AppInfoService } from './app-info-service';
import { useAdbStore } from '@/hooks/useAdbStore';

// 独立实例：clear* 仅操作按 serial 索引的 IndexedDB，底层库在实例间共享，
// 故多实例无碍；且无 live adb 依赖，设备已断开（forget 时常见）也能正确失效缓存。
const service = new AppInfoService();

function fireAndForget(
  promise: Promise<void>,
  label: string,
  onDone?: () => void,
): void {
  promise
    .then(() => onDone?.())
    .catch((e) => console.warn(`[forgetDeviceCache] ${label}失败:`, e));
}

/**
 * 设备被「忘记」时，按 adb serial 失效其 dex 缓存：
 * AppInfoCache（图标/标签元数据包）+ DeviceAppsStore（列表/固定/启动统计）
 * + prefsStore（固定/启动计数）。
 *
 * 效果：重连时 syncWithDevice 的 toParse 自然为全量 → parseAllApps 必跑 →
 * 完整重拉，符合「删除设备 = 从零开始」心智（见 ADR-0009 D2）。
 *
 * 关键：调用方可能传入 RememberedDevice.serial（= remember 时写入的 device.id），
 * 而运行时缓存以 store.deviceSerial（= connectOnce 写入的 device.serial）为键，
 * 二者字符串可能因 device.id 与 device.serial 不一致而不同。故本函数额外清除
 * 「当前已连接会话」的 serial，保证重连必触发全量重拉（ADR-0009 D2 兜底）。
 *
 * 失败仅记日志，不影响 forget 主流程。所有动作均打印可见日志，便于控制台追踪。
 */
export function forgetDeviceCache(serial: string): void {
  if (!serial) {
    console.warn('[forgetDeviceCache] 收到空 serial，跳过缓存失效');
    return;
  }
  console.log(`[forgetDeviceCache] 开始失效设备 ${serial} 的 dex 缓存（图标/列表/偏好）`);

  // 兜底：一并失效当前会话 serial，避免调用方 serial 与运行时 serial 不一致导致漏清。
  const currentSerial = useAdbStore.getState().deviceSerial;
  if (currentSerial && currentSerial !== serial) {
    console.log(`[forgetDeviceCache] 一并失效当前会话 serial ${currentSerial}`);
    fireAndForget(service.clearDeviceAppCache(currentSerial), `清除图标缓存(${currentSerial})`);
    fireAndForget(service.clearDevicePreferences(currentSerial), `清除偏好(${currentSerial})`);
  }

  fireAndForget(
    service.clearDeviceAppCache(serial),
    '清除图标缓存',
    () => console.log(`[forgetDeviceCache] 已清除 ${serial} 图标缓存`),
  );
  fireAndForget(
    service.clearDevicePreferences(serial),
    '清除偏好',
    () => console.log(`[forgetDeviceCache] 已清除 ${serial} 偏好与列表`),
  );
}
