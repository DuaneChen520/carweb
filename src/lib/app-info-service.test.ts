import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { AppInfoService } from './app-info-service';
import type { QuickParseResult } from './device-app-parser';
import type { AppInfo } from './app-info-cache';

const mockCacheGet = vi.fn<(pkg: string) => Promise<AppInfo | null>>();
const mockParserExecuteQuickDex = vi.fn<() => Promise<QuickParseResult>>();

vi.mock('./app-info-cache', () => ({
  AppInfoCache: class MockAppInfoCache {
    get = mockCacheGet;
    set = vi.fn();
    getAllPackageNames = vi.fn().mockResolvedValue([]);
    count = vi.fn().mockResolvedValue(0);
    clear = vi.fn().mockResolvedValue(undefined);
    getCacheSize = vi.fn().mockResolvedValue(0);
  },
}));

vi.mock('./device-app-parser', () => ({
  DeviceAppParser: class MockDeviceAppParser {
    executeQuickDex = mockParserExecuteQuickDex;
  },
}));

describe('AppInfoService', () => {
  let service: AppInfoService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
  });

  describe('syncWithDevice', () => {
    it('should return all apps as toParse when cache is empty', async () => {
      const mockAdb = {} as Adb;
      const mockResult: QuickParseResult = {
        apps: [
          { packageName: 'com.example.a', versionCode: 1 },
          { packageName: 'com.example.b', versionCode: 2 },
        ],
      };

      mockParserExecuteQuickDex.mockResolvedValue(mockResult);
      mockCacheGet.mockResolvedValue(null);

      const result = await service.syncWithDevice(mockAdb);

      expect(result.toParse).toEqual(['com.example.a', 'com.example.b']);
      expect(result.deviceApps).toEqual(
        new Map([
          ['com.example.a', 1],
          ['com.example.b', 2],
        ])
      );
    });

    it('should skip cached apps with same versionCode', async () => {
      const mockAdb = {} as Adb;
      const mockResult: QuickParseResult = {
        apps: [
          { packageName: 'com.cached', versionCode: 5 },
          { packageName: 'com.new', versionCode: 1 },
        ],
      };

      mockParserExecuteQuickDex.mockResolvedValue(mockResult);
      mockCacheGet.mockImplementation(async (pkg: string) => {
        if (pkg === 'com.cached') {
          return {
            packageName: 'com.cached',
            label: 'Cached App',
            iconBase64: null,
            versionCode: 5,
            lastParsed: Date.now(),
          };
        }
        return null;
      });

      const result = await service.syncWithDevice(mockAdb);

      expect(result.toParse).toEqual(['com.new']);
      expect(result.deviceApps).toEqual(
        new Map([
          ['com.cached', 5],
          ['com.new', 1],
        ])
      );
    });

    it('should include cached apps with different versionCode in toParse', async () => {
      const mockAdb = {} as Adb;
      const mockResult: QuickParseResult = {
        apps: [
          { packageName: 'com.updated', versionCode: 3 },
        ],
      };

      mockParserExecuteQuickDex.mockResolvedValue(mockResult);
      mockCacheGet.mockImplementation(async (pkg: string) => {
        if (pkg === 'com.updated') {
          return {
            packageName: 'com.updated',
            label: 'Old Version',
            iconBase64: null,
            versionCode: 2,
            lastParsed: Date.now(),
          };
        }
        return null;
      });

      const result = await service.syncWithDevice(mockAdb);

      expect(result.toParse).toEqual(['com.updated']);
    });

    it('should handle empty device app list', async () => {
      const mockAdb = {} as Adb;
      mockParserExecuteQuickDex.mockResolvedValue({ apps: [] });

      const result = await service.syncWithDevice(mockAdb);

      expect(result.toParse).toEqual([]);
      expect(result.deviceApps).toEqual(new Map());
    });
  });
});
