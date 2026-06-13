import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppInfoService } from './app-info-service';
import type { Adb } from '@yume-chan/adb';

// Mock ADB and dependencies
vi.mock('app-info-parser', () => ({
  ApkParser: vi.fn().mockImplementation(() => ({
    parse: vi.fn().mockResolvedValue({
      package: 'com.test.app',
      label: 'Test App',
      icon: null,
      versionCode: 1,
    }),
  })),
}));

describe('AppInfoService', () => {
  let service: AppInfoService;
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
    mockAdb = {} as Adb;
  });

  it('getMemoryLimit returns positive number', () => {
    const limit = service.getMemoryLimit();
    expect(limit).toBeGreaterThan(0);
  });

  it('shouldParse returns true when cache miss', async () => {
    // Mock cache miss
    const result = await service.shouldParse('com.test.app', 1);
    expect(result).toBe(true);
  });
});
