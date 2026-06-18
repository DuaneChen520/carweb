import { describe, it, expect, vi } from 'vitest';
import { restoreDevice } from '../usb-device-restore';

describe('restoreDevice', () => {
  it('优先调用 reset，成功后等待重新枚举稳定', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    await restoreDevice({ reset, close }, sleep);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('reset 失败时降级调用 close', async () => {
    const reset = vi.fn().mockRejectedValue(new Error('reset boom'));
    const close = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await restoreDevice({ reset, close }, sleep);
    expect(reset).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('reset 与 close 都失败时不抛出（静默恢复）', async () => {
    const reset = vi.fn().mockRejectedValue(new Error('reset boom'));
    const close = vi.fn().mockRejectedValue(new Error('close boom'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(restoreDevice({ reset, close }, sleep)).resolves.toBeUndefined();
  });
});
