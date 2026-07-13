import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { AppInfoService } from './app-info-service';
import type { QuickParseResult } from './device-app-parser';
import type { AppInfo } from './app-info-cache';

const SERIAL = 'test-serial';

const mockCacheGet = vi.fn<(serial: string, pkg: string) => Promise<AppInfo | null>>();
const mockParserFetchQuickPackageList = vi.fn<(adb?: Adb, signal?: AbortSignal) => Promise<QuickParseResult>>();
const mockStoreGetAll = vi.fn<() => Promise<unknown[]>>();
const mockStoreSetAll = vi.fn<() => Promise<void>>();

vi.mock('./app-info-cache', () => ({
  AppInfoCache: class MockAppInfoCache {
    get = mockCacheGet;
  },
}));

vi.mock('./device-apps-store', () => ({
  DeviceAppsStore: class MockDeviceAppsStore {
    getAll = mockStoreGetAll;
    setAll = mockStoreSetAll;
  },
}));

vi.mock('./device-app-parser', () => ({
  DeviceAppParser: class MockDeviceAppParser {
    fetchQuickPackageList = mockParserFetchQuickPackageList;
  },
}));

function cached(pkg: string, versionCode: number): AppInfo {
  return {
    deviceSerial: SERIAL,
    packageName: pkg,
    label: pkg,
    iconBase64: null,
    versionCode,
    lastParsed: Date.now(),
  };
}

describe('AppInfoService', () => {
  let service: AppInfoService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreGetAll.mockResolvedValue([]);
    mockStoreSetAll.mockResolvedValue(undefined);
    service = new AppInfoService();
  });

  describe('syncWithDevice', () => {
    it('should return all apps as toParse when cache is empty', async () => {
      const mockAdb = {} as Adb;
      mockParserFetchQuickPackageList.mockResolvedValue({
        apps: [
          { packageName: 'com.example.a', versionCode: 1 },
          { packageName: 'com.example.b', versionCode: 2 },
        ],
      });
      mockCacheGet.mockResolvedValue(null);

      const result = await service.syncWithDevice(mockAdb, SERIAL);

      expect(result.toParse).toEqual(['com.example.a', 'com.example.b']);
      expect(result.deviceApps).toEqual(
        new Map([
          ['com.example.a', 1],
          ['com.example.b', 2],
        ])
      );
      // 设备端列表应已写回 DeviceAppsStore
      expect(mockStoreSetAll).toHaveBeenCalledTimes(1);
    });

    it('should skip cached apps with same versionCode', async () => {
      const mockAdb = {} as Adb;
      mockParserFetchQuickPackageList.mockResolvedValue({
        apps: [
          { packageName: 'com.cached', versionCode: 5 },
          { packageName: 'com.new', versionCode: 1 },
        ],
      });
      mockCacheGet.mockImplementation(async (_serial, pkg) => {
        if (pkg === 'com.cached') return cached('com.cached', 5);
        return null;
      });

      const result = await service.syncWithDevice(mockAdb, SERIAL);

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
      mockParserFetchQuickPackageList.mockResolvedValue({
        apps: [{ packageName: 'com.updated', versionCode: 3 }],
      });
      mockCacheGet.mockImplementation(async (_serial, pkg) => {
        if (pkg === 'com.updated') return cached('com.updated', 2); // 缓存是旧版本 2
        return null;
      });

      const result = await service.syncWithDevice(mockAdb, SERIAL);

      expect(result.toParse).toEqual(['com.updated']);
    });

    it('should handle empty device app list', async () => {
      const mockAdb = {} as Adb;
      mockParserFetchQuickPackageList.mockResolvedValue({ apps: [] });

      const result = await service.syncWithDevice(mockAdb, SERIAL);

      expect(result.toParse).toEqual([]);
      expect(result.deviceApps).toEqual(new Map());
    });
  });
});
