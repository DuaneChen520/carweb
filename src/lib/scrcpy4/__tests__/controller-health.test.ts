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

  it('致命错误（非可恢复）直接 DEAD', () => {
    health.markHealthy();
    health.reportError(new TypeError('controller is undefined'));
    expect(health.state).toBe('DEAD');
  });

  it('可恢复瞬时错误（Backpressure）→ DEGRADED', () => {
    health.markHealthy();
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEGRADED');
  });

  it('可恢复瞬时错误（Cannot write to a CLOSED stream）→ DEGRADED', () => {
    health.markHealthy();
    health.reportError(new Error('Cannot write to a CLOSED writable stream'));
    expect(health.state).toBe('DEGRADED');
  });

  it('可恢复瞬时错误重试成功 → 回 HEALTHY（计数清零，不累积成永久故障）', () => {
    health.markHealthy();
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEGRADED');
    health.markHealthy();
    expect(health.state).toBe('HEALTHY');
    // 成功后再来一次瞬时错误仍只到 DEGRADED（计数已清零，不会误判 DEAD）
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEGRADED');
  });

  it('可恢复瞬时错误连续重试用尽 → DEAD', () => {
    health.markHealthy();
    for (let i = 0; i < 3; i++) {
      health.reportError(new Error('Backpressure failed'));
      expect(health.state).toBe('DEGRADED');
    }
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEAD');
  });

  it('Socket closed 仍视为可恢复（DEGRADED 计数）', () => {
    health.markHealthy();
    health.reportError(new Error('Socket closed'));
    expect(health.state).toBe('DEGRADED');
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

  it('重置后计数归零，瞬时错误需重新累积才 DEAD', () => {
    health.markHealthy();
    health.reportError(new Error('Backpressure failed'));
    health.reportError(new Error('Backpressure failed'));
    health.reportError(new Error('Backpressure failed'));
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEAD'); // maxRetries=3，第 4 次重试用尽
    health.reset();
    health.markHealthy(); // 模拟重连成功进入 HEALTHY
    health.reportError(new Error('Backpressure failed'));
    expect(health.state).toBe('DEGRADED'); // 计数已归零，重新从 DEGRADED 开始
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

  it('带 tag 时 DEGRADED/DEAD 日志带会话前缀（多会话定位）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const h = new ControllerHealth({ maxRetries: 3, tag: 'session-abc' });

    h.markHealthy();
    h.reportError(new Error('Socket closed'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[CtrlHealth:session-abc] DEGRADED'));

    for (let i = 0; i < 3; i++) h.reportError(new Error('Socket closed'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[CtrlHealth:session-abc] DEAD'));

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('不带 tag 时日志保持默认前缀', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const h = new ControllerHealth({ maxRetries: 3 });
    h.markHealthy();
    h.reportError(new Error('Socket closed'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[CtrlHealth] DEGRADED'));
    logSpy.mockRestore();
  });
});