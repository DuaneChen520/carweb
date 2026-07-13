import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { AppInfoService } from './app-info-service';
import type { QuickParseResult, ParseResult } from './device-app-parser';
import type { AppInfo } from './app-info-cache';

const mockCacheGet = vi.fn<(deviceSerial: string, packageName: string) => Promise<AppInfo | null>>();
const mockCacheSetAll = vi.fn().mockResolvedValue(undefined);
const mockFetchQuickPackageList = vi.fn<() => Promise<QuickParseResult>>();
const mockParseAllApps = vi.fn<() => Promise<ParseResult>>();

vi.mock('./app-info-cache', () => ({
  AppInfoCache: class MockAppInfoCache {
    get = mockCacheGet;
    setAll = mockCacheSetAll;
    set = vi.fn();
    getAllPackageNames = vi.fn().mockResolvedValue([]);
    count = vi.fn().mockResolvedValue(0);
    clear = vi.fn().mockResolvedValue(undefined);
    getCacheSize = vi.fn().mockResolvedValue(0);
  },
}));

vi.mock('./device-app-parser', () => ({
  DeviceAppParser: class MockDeviceAppParser {
    fetchQuickPackageList = mockFetchQuickPackageList;
    parseAllApps = mockParseAllApps;
  },
}));

const SERIAL = (suffix: string) => `test-serial-${suffix}`;

const quickApps = (apps: { packageName: string; versionCode: number }[]) => ({ apps });

const fullApps = (apps: { packageName: string; versionCode: number }[]): ParseResult => ({
  apps: apps.map((a) => ({
    packageName: a.packageName,
    label: a.packageName,
    iconBase64: null,
    versionCode: a.versionCode,
    launchCount: 0,
  })),
  errors: [],
});

describe('AppInfoService.syncAndParseIfNeeded（连接级自动同步触发）', () => {
  let service: AppInfoService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
  });

  it('空缓存时：对全部包跑全量 dex，并填充 DeviceAppsStore（删除防护）', async () => {
    const serial = SERIAL('empty');
    const mockAdb = {} as Adb;
    const apps = [
      { packageName: 'com.example.a', versionCode: 1 },
      { packageName: 'com.example.b', versionCode: 2 },
    ];

    mockFetchQuickPackageList.mockResolvedValue(quickApps(apps));
    mockCacheGet.mockResolvedValue(null);
    mockParseAllApps.mockResolvedValue(fullApps(apps));

    const result = await service.syncAndParseIfNeeded(mockAdb, serial);

    // toParse = 全部（缓存为空），故应触发全量解析
    expect(result.toParse).toEqual(['com.example.a', 'com.example.b']);
    expect(mockParseAllApps).toHaveBeenCalledTimes(1);

    // 真实 DeviceAppsStore 已被增量比对 + 解析结果填充
    const stored = await service.getAllDeviceApps(serial);
    expect(stored.map((r) => r.packageName).sort()).toEqual(['com.example.a', 'com.example.b']);
  });

  it('versionCode 全匹配时：不跑全量 dex，但 DeviceAppsStore 仍由 syncWithDevice 填充', async () => {
    const serial = SERIAL('fresh');
    const mockAdb = {} as Adb;
    const apps = [
      { packageName: 'com.cached.a', versionCode: 5 },
      { packageName: 'com.cached.b', versionCode: 7 },
    ];

    mockFetchQuickPackageList.mockResolvedValue(quickApps(apps));
    mockCacheGet.mockImplementation(async (_serial: string, pkg: string) => {
      const found = apps.find((a) => a.packageName === pkg);
      return found
        ? { packageName: pkg, label: pkg, iconBase64: null, versionCode: found.versionCode, lastParsed: Date.now(), deviceSerial: serial }
        : null;
    });

    const result = await service.syncAndParseIfNeeded(mockAdb, serial);

    expect(result.toParse).toEqual([]);
    expect(mockParseAllApps).not.toHaveBeenCalled();

    // 即便未跑全量 dex，轻量 sync 已写入 DeviceAppsStore
    const stored = await service.getAllDeviceApps(serial);
    expect(stored.map((r) => r.packageName).sort()).toEqual(['com.cached.a', 'com.cached.b']);
  });

  it('仅 versionCode 变更的包进入 toParse，并触发一次全量 dex（增量正确性）', async () => {
    const serial = SERIAL('mismatch');
    const mockAdb = {} as Adb;
    const apps = [
      { packageName: 'com.kept', versionCode: 1 },
      { packageName: 'com.updated', versionCode: 3 },
    ];

    mockFetchQuickPackageList.mockResolvedValue(quickApps(apps));
    mockCacheGet.mockImplementation(async (_serial: string, pkg: string) => {
      if (pkg === 'com.updated') {
        // 缓存里是旧版本 2，设备上是 3 → 校验不通过
        return { packageName: pkg, label: 'old', iconBase64: null, versionCode: 2, lastParsed: Date.now(), deviceSerial: serial };
      }
      if (pkg === 'com.kept') {
        return { packageName: pkg, label: 'kept', iconBase64: null, versionCode: 1, lastParsed: Date.now(), deviceSerial: serial };
      }
      return null;
    });
    mockParseAllApps.mockResolvedValue(fullApps(apps));

    const result = await service.syncAndParseIfNeeded(mockAdb, serial);

    expect(result.toParse).toEqual(['com.updated']);
    expect(mockParseAllApps).toHaveBeenCalledTimes(1);
  });

  it('可重复调用（模拟重连重入）不抛错，且第二次同步仍正常', async () => {
    const serial = SERIAL('reconnect');
    const mockAdb = {} as Adb;
    const apps = [{ packageName: 'com.re.a', versionCode: 1 }];

    mockFetchQuickPackageList.mockResolvedValue(quickApps(apps));
    mockCacheGet.mockResolvedValue(null);
    mockParseAllApps.mockResolvedValue(fullApps(apps));

    await expect(service.syncAndParseIfNeeded(mockAdb, serial)).resolves.toBeDefined();
    await expect(service.syncAndParseIfNeeded(mockAdb, serial)).resolves.toBeDefined();

    expect(mockParseAllApps).toHaveBeenCalledTimes(2);
  });

  it('设备应用列表为空时：toParse 为空，不触发任何解析', async () => {
    // service 层 syncWithDevice 需真实 adb（{} 即可），此处用空列表模拟「无应用」的安全路径。
    const serial = SERIAL('noop');
    const mockAdb = {} as Adb;
    mockFetchQuickPackageList.mockResolvedValue(quickApps([]));

    const result = await service.syncAndParseIfNeeded(mockAdb, serial);

    expect(result.toParse).toEqual([]);
    expect(mockParseAllApps).not.toHaveBeenCalled();
  });
});
