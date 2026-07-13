import { describe, it, expect, afterEach, vi } from 'vitest';
import { forgetDeviceCache } from './forget-device-cache';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { DeviceAppsStore, type DeviceAppRecord } from './device-apps-store';
import { UserPreferencesStore } from './user-preferences-store';

const SERIAL = 'forget-test-serial';

function makeInfo(pkg: string, serial: string = SERIAL): AppInfo {
  return {
    deviceSerial: serial,
    packageName: pkg,
    label: pkg,
    iconBase64: null,
    versionCode: 1,
    lastParsed: Date.now(),
  };
}

function makeRecord(pkg: string, pinned = true): DeviceAppRecord {
  return {
    deviceSerial: SERIAL,
    packageName: pkg,
    versionCode: 1,
    launchCount: 5,
    localCount: 3,
    pinned,
    pinOrder: 0,
    lastSynced: Date.now(),
  };
}

describe('forgetDeviceCache', () => {
  const cache = new AppInfoCache();
  const appsStore = new DeviceAppsStore();
  const prefs = new UserPreferencesStore();

  afterEach(async () => {
    await Promise.all([cache.clearAll(), appsStore.clearAll(), prefs.clearAllDevices()]);
  });

  it('按 serial 失效 AppInfoCache + DeviceAppsStore + prefsStore 三条缓存', async () => {
    await cache.setAll(SERIAL, [makeInfo('com.a'), makeInfo('com.b')]);
    await appsStore.setAll(SERIAL, [makeRecord('com.a'), makeRecord('com.b')]);
    await prefs.setPinned(SERIAL, [{ deviceSerial: SERIAL, packageName: 'com.a', order: 0 }]);

    expect(await cache.getAllForDevice(SERIAL)).toHaveLength(2);
    expect(await appsStore.getAll(SERIAL)).toHaveLength(2);
    expect(await prefs.getPinned(SERIAL)).toHaveLength(1);

    forgetDeviceCache(SERIAL);

    // 函数为 fire-and-forget，轮询直至三条缓存均被清空
    await vi.waitFor(async () => {
      expect(await cache.getAllForDevice(SERIAL)).toHaveLength(0);
      expect(await appsStore.getAll(SERIAL)).toHaveLength(0);
      expect(await prefs.getPinned(SERIAL)).toHaveLength(0);
    });
  });

  it('不影响其它 serial 的缓存', async () => {
    const OTHER = 'other-serial';
    await cache.setAll(SERIAL, [makeInfo('com.a')]);
    await cache.setAll(OTHER, [makeInfo('com.keep', OTHER)]);

    forgetDeviceCache(SERIAL);

    await vi.waitFor(async () => {
      expect(await cache.getAllForDevice(SERIAL)).toHaveLength(0);
    });
    expect(await cache.getAllForDevice(OTHER)).toHaveLength(1);
  });

  it('空 serial 安全返回，不抛错', () => {
    expect(() => forgetDeviceCache('')).not.toThrow();
  });
});
