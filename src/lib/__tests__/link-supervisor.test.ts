import { describe, it, expect, vi } from 'vitest';
import { LinkSupervisor, type AdbLinkSignal } from '../link-supervisor';
import { ControllerHealth } from '../scrcpy4';

/** 等待 linkState 达到目标值（或超时）。 */
function waitForState(s: LinkSupervisor, target: string, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (s.linkState === target) return resolve();
    const unsub = s.onLinkStateChange((st) => {
      if (st === target) {
        unsub();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timeout waiting for ${target}, got ${s.linkState}`));
    }, timeout);
  });
}

/** 构造一个可控的 ADB 信号源。 */
function makeAdbSignal() {
  let cb: ((connected: boolean) => void) | null = null;
  const signal: AdbLinkSignal = {
    subscribe: (onChange) => {
      cb = onChange;
      return () => {
        cb = null;
      };
    },
  };
  return { signal, emit: (connected: boolean) => cb && cb(connected) };
}

/** 让 control-socket 子监视器进入 DEAD（需先 healthy 基线）。 */
function driveToDead(ch: ControllerHealth): void {
  ch.markHealthy();
  for (let i = 0; i < 4; i++) ch.reportError(new Error('Socket closed'));
}

describe('LinkSupervisor', () => {
  it('初始为 connected', () => {
    const s = new LinkSupervisor({ reconnect: vi.fn() });
    expect(s.linkState).toBe('connected');
    s.dispose();
  });

  it('control-socket DEGRADED → linkState degraded', () => {
    const ch = new ControllerHealth();
    const s = new LinkSupervisor({ reconnect: vi.fn(), controlHealth: ch });
    ch.markHealthy();
    ch.reportError(new Error('Socket closed'));
    expect(s.linkState).toBe('degraded');
    s.dispose();
  });

  it('control-socket DEAD → reconnecting → connected（策略成功，attempt=1）', async () => {
    const ch = new ControllerHealth();
    const strategy = vi.fn().mockResolvedValue(undefined);
    const s = new LinkSupervisor({ reconnect: strategy, controlHealth: ch, backoffBaseMs: 0 });
    driveToDead(ch);
    await waitForState(s, 'connected');
    expect(strategy).toHaveBeenCalledTimes(1);
    expect(strategy).toHaveBeenCalledWith(1);
    s.dispose();
  });

  it('重连策略失败耗尽 → failed，且计满 maxAttempts', async () => {
    const ch = new ControllerHealth();
    const strategy = vi.fn().mockRejectedValue(new Error('boom'));
    const s = new LinkSupervisor({
      reconnect: strategy,
      controlHealth: ch,
      backoffBaseMs: 0,
      maxReconnectAttempts: 3,
    });
    driveToDead(ch);
    await waitForState(s, 'failed');
    expect(strategy).toHaveBeenCalledTimes(3);
    expect(strategy).toHaveBeenNthCalledWith(3, 3);
    s.dispose();
  });

  it('ADB-down 优先：立即 disconnected 且不触发 scrcpy 重连；ADB 恢复后重连', async () => {
    const ch = new ControllerHealth();
    const strategy = vi.fn().mockResolvedValue(undefined);
    const s = new LinkSupervisor({ reconnect: strategy, controlHealth: ch, backoffBaseMs: 0 });
    const { signal, emit } = makeAdbSignal();
    s.attachAdbSignal(signal);

    emit(false); // ADB 断开
    expect(s.linkState).toBe('disconnected');

    // control-socket 即便 DEAD，也不应触发重连（传输已失）
    driveToDead(ch);
    expect(s.linkState).toBe('disconnected');
    expect(strategy).not.toHaveBeenCalled();

    // ADB 恢复且 control-socket 仍 DEAD → 触发重连
    emit(true);
    await waitForState(s, 'connected');
    expect(strategy).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('dispose 退订内部订阅与监听者', () => {
    const ch = new ControllerHealth();
    const s = new LinkSupervisor({ reconnect: vi.fn(), controlHealth: ch });
    const listener = vi.fn();
    s.onLinkStateChange(listener);
    s.dispose();
    ch.markHealthy();
    ch.reportError(new Error('Socket closed'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('兼容 ControllerHealth 接口：tryGetController 在 DEAD 返回 null', () => {
    const ch = new ControllerHealth();
    const s = new LinkSupervisor({ reconnect: vi.fn(), controlHealth: ch });
    const ref = { current: { id: 'ctrl' } as unknown };
    expect(s.tryGetController(ref)).not.toBeNull();
    driveToDead(ch);
    expect(s.tryGetController(ref)).toBeNull();
    s.dispose();
  });
});
