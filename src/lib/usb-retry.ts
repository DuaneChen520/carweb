/**
 * USB 自动重连的纯策略函数。
 *
 * 设计目标：页面刷新后手机端 adbd 旧连接尚未释放，新连接会被对端关闭
 * （"Connection closed unexpectedly"）。本模块用固定的指数退避序列覆盖该竞态，
 * 而非做任何持久化记忆——因为并非每次连接都撞到刷新竞态。
 */

/** 每次尝试前的等待毫秒数；索引即第几次尝试（0 = 立即乐观）。 */
export const RETRY_DELAYS: readonly number[] = [0, 500, 1200, 2000] as const;

/** 匹配刷新竞态/USB 接口暂被占用类错误的正则。 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /connection closed unexpectedly/i,
  /failed to open/i,
  /unable to claim interface/i,
  /device not configured/i,
  /network error/i,
];

/** 匹配不可恢复、重试无意义的错误正则（用户未授权、设备已移除）。 */
const FATAL_PATTERNS: RegExp[] = [
  /access denied/i,
  /not found/i,
  /securityerror/i,
  /no device/i,
];

/** 判定一个错误是否值得继续重试（瞬时错误）。 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** 判定一个错误是否致命（重试无意义，应立即停止）。 */
export function isFatalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return FATAL_PATTERNS.some((re) => re.test(message));
}

/**
 * 判定是否应该继续重试。
 *
 * 约定：致命错误永不重试；其余未知错误默认重试（保守策略——宁可多试一次
 * 让用户连上，也不轻易放弃进手动态）。
 */
export function shouldRetry(error: unknown): boolean {
  return !isFatalError(error);
}
