import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppInfoService } from './app-info-service';

vi.mock('app-info-parser', () => ({
  default: vi.fn().mockImplementation(() => ({
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

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
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
