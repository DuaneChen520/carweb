import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControllerHealth } from '../controller-health';

describe('ControllerHealth', () => {
  let health: ControllerHealth;

  beforeEach(() => {
    health = new ControllerHealth({ maxRetries: 3 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态为 IDLE', () => {
    expect(health.state).toBe('IDLE');
  });

  it('IDLE → HEALTHY（首次成功 write）', () => {
    health.markHealthy();
    expect(health.state).toBe('HEALTHY');
  });

  it('HEALTHY → DEGRADED（Socket closed）', () => {
    health.markHealthy();
    health.reportError(new Error('Socket closed'));
    expect(health.state).toBe('DEGRADED');
  });

  it('DEGRADED → HEALTHY（重试成功）', () => {
    health.markHealthy();
    health.reportError(new Error('Socket closed'));
    expect(health.state).toBe('DEGRADED');
    health.markHealthy();
    expect(health.state).toBe('HEALTHY');
  });

  it('DEGRADED → DEAD（重试用尽）', () => {
    health.markHealthy();
    // 4 次 Socket closed（maxRetries=3 意味着 3 次 DEGRADED + 第 4 次 DEAD）
    for (let i = 0; i < 3; i++) {
      health.reportError(new Error('Socket closed'));
      expect(health.state).toBe('DEGRADED');
    }
    health.reportError(new Error('Socket closed'));
    expect(health.state).toBe('DEAD');
  });

  it('非 Socket closed 错误直接 DEAD', () => {
    health.markHealthy();
    health.reportError(new TypeError('controller is undefined'));
    expect(health.state).toBe('DEAD');
  });

  it('DEAD 态 tryGetController 返回 null', () => {
    const ref = { current: {} };
    health.markHealthy();
    health.reportError(new TypeError('fatal'));
    expect(health.state).toBe('DEAD');
    const result = health.tryGetController(ref);
    expect(result).toBeNull();
  });

  it('HEALTHY 态 tryGetController 返回 ref.current', () => {
    const ctrl = {};
    const ref = { current: ctrl };
    health.markHealthy();
    const result = health.tryGetController(ref);
    expect(result).toBe(ctrl);
  });

  it('IDLE 态 tryGetController 返回 ref.current（允许首次写入）', () => {
    const ctrl = {};
    const ref = { current: ctrl };
    const result = health.tryGetController(ref);
    expect(result).toBe(ctrl);
  });

  it('重置后回到 IDLE', () => {
    health.markHealthy();
    health.reportError(new TypeError('fatal'));
    expect(health.state).toBe('DEAD');
    health.reset();
    expect(health.state).toBe('IDLE');
  });

  it('状态转换发出 onStateChange 事件', () => {
    const listener = vi.fn();
    health.onStateChange(listener);
    health.markHealthy();
    expect(listener).toHaveBeenCalledWith('HEALTHY');
  });

  it('onStateChange 返回取消订阅函数', () => {
    const listener = vi.fn();
    const unsub = health.onStateChange(listener);
    unsub();
    health.markHealthy();
    expect(listener).not.toHaveBeenCalled();
  });

  it('isDead 返回正确布尔值', () => {
    expect(health.isDead()).toBe(false);
    health.markHealthy();
    expect(health.isDead()).toBe(false);
    health.reportError(new TypeError('fatal'));
    expect(health.isDead()).toBe(true);
  });

  it('maxRetries=0 时首次 Socket closed 直接 DEAD', () => {
    const h = new ControllerHealth({ maxRetries: 0 });
    h.markHealthy();
    h.reportError(new Error('Socket closed'));
    expect(h.state).toBe('DEAD');
  });
});