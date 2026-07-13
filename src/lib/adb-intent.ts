import type { Adb } from '@yume-chan/adb';

/**
 * 区分「应用层有意断开」与「真实掉线」的标记。
 *
 * 根因（见 docs/adr/0007）：`adb.disconnected` 回调不区分本次关闭是否由
 * 应用层有意发起（重连前置的 `store.disconnect()`、用户点「停止」、页面卸载），
 * 还是物理掉线 / USB 异常。两者都被混写为 `connectionStatus='disconnected'`，
 * 从而让 `App.tsx` 在桌面已显示（overlay=hidden）时误弹「USB 连接已断开」。
 *
 * 用 WeakSet 而非 `(adb as any).__intentionalClose`，理由：
 * - 类型安全，无需 `any`；
 * - 以 adb 对象为键，自动随对象 GC，无泄漏；
 * - `mark` 同步写入（须先于异步的 `adb.close()`），`consume` 读取后清除，
 *   保证「标记一次、消费一次」。
 */
const intentionalClose = new WeakSet<Adb>();

/** 在 `adb.close()` **之前**同步调用，声明本次关闭是应用层有意发起。 */
export function markIntentionalClose(adb: Adb): void {
  intentionalClose.add(adb);
}

/**
 * 读取并清除标记。返回 true 表示「有意断开」，应降级为 `idle` 而非 `disconnected`。
 * 仅首次读取为真（消费后删除），因此两个 then 分支中只有一个会命中。
 */
export function consumeIntentionalClose(adb: Adb): boolean {
  if (intentionalClose.has(adb)) {
    intentionalClose.delete(adb);
    return true;
  }
  return false;
}
