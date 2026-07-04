import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControllerHealth } from '../controller-health';

describe('reconnect integration', () => {
  let health: ControllerHealth;
  let reconnectFn: ReturnType<typeof vi.fn>;
  let stopFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    health = new ControllerHealth({ maxRetries: 3 });
    stopFn = vi.fn().mockResolvedValue(undefined);
    reconnectFn = vi.fn().mockImplementation(async () => {
      // 模拟重连流程：stop → 退避 → reset → markHealthy
      await stopFn();
      health.reset();
      health.markHealthy();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('DEAD 态触发 reconnect，调 stop + reset + markHealthy', async () => {
    health.markHealthy();
    health.reportError(new TypeError('fatal'));
    expect(health.state).toBe('DEAD');

    await reconnectFn();
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(health.state).toBe('HEALTHY');
  });

  it('DEAD 态 tryGetController 在重连前返回 null', () => {
    const ctrl = {};
    const ref = { current: ctrl };
    health.markHealthy();
    health.reportError(new TypeError('fatal'));

    expect(health.tryGetController(ref)).toBeNull();
  });

  it('重连成功后 tryGetController 返回新 controller', async () => {
    const ref = { current: null };
    health.markHealthy();
    health.reportError(new TypeError('fatal'));

    // 重连后设置新 controller
    ref.current = { newCtrl: true };
    health.reset();
    health.markHealthy();

    expect(health.tryGetController(ref)).toEqual({ newCtrl: true });
  });

  it('maxRetries=0 时首次 Socket closed 直接 DEAD', () => {
    const h = new ControllerHealth({ maxRetries: 0 });
    h.markHealthy();
    h.reportError(new Error('Socket closed'));
    expect(h.state).toBe('DEAD');
  });
});