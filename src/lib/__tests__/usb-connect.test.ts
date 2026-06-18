import { describe, it, expect, vi } from 'vitest';
import { retryConnectUsb, type RetryConnectDeps } from '../usb-connect';

class MockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Error';
  }
}

function makeDeps(overrides: Partial<RetryConnectDeps> = {}): RetryConnectDeps {
  return {
    findDevice: vi.fn().mockResolvedValue({ serial: 'S1' } as never),
    connectOnce: vi.fn().mockResolvedValue(undefined),
    prepareDevice: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    isCancelled: () => false,
    ...overrides,
  };
}

describe('retryConnectUsb', () => {
  it('首次成功则不重试、不 sleep', async () => {
    const deps = makeDeps();
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(deps.connectOnce).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('瞬时错误触发重试直到成功', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('致命错误立即终止，不重试', async () => {
    const deps = makeDeps({
      connectOnce: vi.fn().mockRejectedValue(new MockError('Access Denied.')),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(deps.connectOnce).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('用尽重试次数后失败', async () => {
    const deps = makeDeps({
      connectOnce: vi.fn().mockRejectedValue(new MockError('Connection closed unexpectedly')),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(4); // RETRY_DELAYS.length
    expect(deps.connectOnce).toHaveBeenCalledTimes(4);
  });

  it('每次尝试前重新枚举设备（prepareDevice）', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    await retryConnectUsb('S1', deps);
    expect(deps.prepareDevice).toHaveBeenCalledTimes(2);
  });

  it('设备枚举不到时立即失败（不重试）', async () => {
    const deps = makeDeps({
      findDevice: vi.fn().mockResolvedValue(null),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(deps.connectOnce).not.toHaveBeenCalled();
  });

  it('进度回调报告每次尝试的序号', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    const onProgress = vi.fn();
    await retryConnectUsb('S1', { ...deps, onProgress });
    // 第 1 次：attempt=1/4；重试；第 2 次 attempt=2/4；重试；第 3 次成功
    expect(onProgress).toHaveBeenCalledWith({ attempt: 1, total: 4, retrying: false });
    expect(onProgress).toHaveBeenCalledWith({ attempt: 2, total: 4, retrying: true });
    expect(onProgress).toHaveBeenCalledWith({ attempt: 3, total: 4, retrying: true });
  });

  it('外部取消时立即停止', async () => {
    let cancelled = false;
    const deps = makeDeps({
      // 第一次失败的同时同步翻转取消标志（确定性，不依赖宏任务时序）
      connectOnce: vi.fn().mockImplementation(() => {
        cancelled = true;
        return Promise.reject(new MockError('Connection closed unexpectedly'));
      }),
      isCancelled: () => cancelled,
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    // 取消后不应再继续重试
    expect(deps.connectOnce).toHaveBeenCalledTimes(1);
  });
});
