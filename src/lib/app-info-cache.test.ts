import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppInfoCache, type AppInfo } from './app-info-cache';

const SERIAL_A = 'test-serial-a';
const SERIAL_B = 'test-serial-b';

function makeInfo(serial: string, pkg: string, versionCode = 1): AppInfo {
  return {
    deviceSerial: serial,
    packageName: pkg,
    label: `label-${pkg}`,
    iconBase64: 'data:image/png;base64,xxx',
    versionCode,
    lastParsed: Date.now(),
  };
}

describe('AppInfoCache', () => {
  let cache: AppInfoCache;

  beforeEach(() => {
    cache = new AppInfoCache('test-app-info-cache');
  });

  afterEach(async () => {
    await cache.clearAll();
  });

  describe('set / get 往返（复合键 [deviceSerial, packageName]）', () => {
    it('未命中时返回 null', async () => {
      const result = await cache.get(SERIAL_A, 'com.example.app');
      expect(result).toBeNull();
    });

    it('set 后 get 返回缓存数据（含复合键字段）', async () => {
      const info = makeInfo(SERIAL_A, 'com.example.app', 3);
      await cache.set(SERIAL_A, 'com.example.app', info);

      const result = await cache.get(SERIAL_A, 'com.example.app');
      expect(result).toEqual(info);
    });
  });

  describe('按设备隔离', () => {
    it('getAllForDevice 仅返回该设备条目', async () => {
      await cache.set(SERIAL_A, 'com.a', makeInfo(SERIAL_A, 'com.a'));
      await cache.set(SERIAL_A, 'com.b', makeInfo(SERIAL_A, 'com.b'));
      await cache.set(SERIAL_B, 'com.c', makeInfo(SERIAL_B, 'com.c'));

      const aApps = await cache.getAllForDevice(SERIAL_A);
      const pkgs = aApps.map((a) => a.packageName).sort();
      expect(pkgs).toEqual(['com.a', 'com.b']);
      expect(aApps.every((a) => a.deviceSerial === SERIAL_A)).toBe(true);
    });

    it('不同设备的相同包名相互独立', async () => {
      await cache.set(SERIAL_A, 'com.dup', makeInfo(SERIAL_A, 'com.dup', 1));
      await cache.set(SERIAL_B, 'com.dup', makeInfo(SERIAL_B, 'com.dup', 2));

      expect((await cache.get(SERIAL_A, 'com.dup'))?.versionCode).toBe(1);
      expect((await cache.get(SERIAL_B, 'com.dup'))?.versionCode).toBe(2);
    });
  });

  describe('setAll 批量写入', () => {
    it('批量写入后逐个可读', async () => {
      const infos = [
        makeInfo(SERIAL_A, 'com.x', 1),
        makeInfo(SERIAL_A, 'com.y', 2),
      ];
      await cache.setAll(SERIAL_A, infos);

      expect((await cache.get(SERIAL_A, 'com.x'))?.versionCode).toBe(1);
      expect((await cache.get(SERIAL_A, 'com.y'))?.versionCode).toBe(2);
    });
  });

  describe('计数与大小', () => {
    it('countForDevice 返回该设备条目数', async () => {
      await cache.setAll(SERIAL_A, [
        makeInfo(SERIAL_A, 'com.1'),
        makeInfo(SERIAL_A, 'com.2'),
      ]);
      expect(await cache.countForDevice(SERIAL_A)).toBe(2);
      expect(await cache.countForDevice(SERIAL_B)).toBe(0);
    });

    it('getCacheSizeForDevice 在空缓存时返回 0', async () => {
      expect(await cache.getCacheSizeForDevice(SERIAL_A)).toBe(0);
    });

    it('getCacheSizeForDevice 返回非零字节数', async () => {
      await cache.set(SERIAL_A, 'com.size', makeInfo(SERIAL_A, 'com.size'));
      expect(await cache.getCacheSizeForDevice(SERIAL_A)).toBeGreaterThan(0);
    });
  });

  describe('清理', () => {
    it('clearForDevice 仅清除该设备', async () => {
      await cache.set(SERIAL_A, 'com.a', makeInfo(SERIAL_A, 'com.a'));
      await cache.set(SERIAL_B, 'com.b', makeInfo(SERIAL_B, 'com.b'));

      await cache.clearForDevice(SERIAL_A);

      expect(await cache.get(SERIAL_A, 'com.a')).toBeNull();
      expect(await cache.get(SERIAL_B, 'com.b')).not.toBeNull();
    });

    it('clearAll 清除所有设备', async () => {
      await cache.set(SERIAL_A, 'com.a', makeInfo(SERIAL_A, 'com.a'));
      await cache.set(SERIAL_B, 'com.b', makeInfo(SERIAL_B, 'com.b'));

      await cache.clearAll();

      expect(await cache.get(SERIAL_A, 'com.a')).toBeNull();
      expect(await cache.get(SERIAL_B, 'com.b')).toBeNull();
      expect(await cache.countAll()).toBe(0);
    });
  });
});
