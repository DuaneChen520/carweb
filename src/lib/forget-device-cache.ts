import { AppInfoService } from './app-info-service';

// 独立实例：clear* 仅操作按 serial 索引的 IndexedDB，底层库在实例间共享，
// 故多实例无碍；且无 live adb 依赖，设备已断开（forget 时常见）也能正确失效缓存。
const service = new AppInfoService();

function fireAndForget(promise: Promise<void>, label: string): void {
  promise.catch((e) => console.warn(`[forgetDeviceCache] ${label}失败:`, e));
}

/**
 * 设备被「忘记」时，按 adb serial 失效其 dex 缓存：
 * AppInfoCache（图标/标签元数据包）+ DeviceAppsStore（列表/固定/启动统计）
 * + prefsStore（固定/启动计数）。
 *
 * 效果：重连时 syncWithDevice 的 toParse 自然为全量 → parseAllApps 必跑 →
 * 完整重拉，符合「删除设备 = 从零开始」心智（见 ADR-0009 D2）。
 *
 * 失败仅记日志，不影响 forget 主流程。
 */
export function forgetDeviceCache(serial: string): void {
  if (!serial) return;
  fireAndForget(service.clearDeviceAppCache(serial), '清除图标缓存');
  fireAndForget(service.clearDevicePreferences(serial), '清除偏好');
}
