import { describe, it, expect } from 'vitest';
import { RETRY_DELAYS, isTransientError, isFatalError } from '../usb-retry';

describe('usb-retry', () => {
  describe('RETRY_DELAYS', () => {
    it('首次尝试延迟为 0（乐观立即连）', () => {
      expect(RETRY_DELAYS[0]).toBe(0);
    });

    it('总共提供 4 次尝试机会', () => {
      expect(RETRY_DELAYS).toHaveLength(4);
    });

    it('延迟严格递增（指数退避）', () => {
      for (let i = 1; i < RETRY_DELAYS.length; i++) {
        expect(RETRY_DELAYS[i]).toBeGreaterThan(RETRY_DELAYS[i - 1]);
      }
    });

    it('最坏总耗时不超过 5 秒', () => {
      const total = RETRY_DELAYS.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(5000);
    });
  });

  describe('isTransientError', () => {
    it('识别 Connection closed unexpectedly 为瞬时错误', () => {
      expect(isTransientError(new Error('Connection closed unexpectedly'))).toBe(true);
    });

    it('识别 Failed to open device 为瞬时错误', () => {
      expect(isTransientError(new Error('Failed to open device.'))).toBe(true);
    });

    it('识别 Unable to claim interface 为瞬时错误', () => {
      expect(isTransientError(new Error('Unable to claim interface.'))).toBe(true);
    });

    it('对未知错误返回 false', () => {
      expect(isTransientError(new Error('something else'))).toBe(false);
    });

    it('对非 Error 对象返回 false', () => {
      expect(isTransientError('string error')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe('isFatalError', () => {
    it('识别 Access Denied 为致命错误（用户未授权）', () => {
      expect(isFatalError(new Error('Access Denied.'))).toBe(true);
    });

    it('识别 Not Found 为致命错误（设备已拔出）', () => {
      expect(isFatalError(new Error('NotFoundError: No device'))).toBe(true);
    });

    it('对瞬时错误返回 false', () => {
      expect(isFatalError(new Error('Connection closed unexpectedly'))).toBe(false);
    });

    it('对未知错误返回 false（默认走重试）', () => {
      expect(isFatalError(new Error('weird'))).toBe(false);
    });
  });
});
