import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppInfoCache, type AppInfo } from './app-info-cache';

const SERIAL = 'integration-serial';

function makeInfo(pkg: string, versionCode = 1): AppInfo {
  return {
    deviceSerial: SERIAL,
    packageName: pkg,
    label: `label-${pkg}`,
    iconBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    versionCode,
    lastParsed: Date.now(),
  };
}

describe('AppInfo Integration', () => {
  let cache: AppInfoCache;

  beforeEach(() => {
    cache = new AppInfoCache('integration-test');
  });

  afterEach(async () => {
    await cache.clearAll();
  });

  it('cache stores and retrieves app info correctly', async () => {
    const appInfo = makeInfo('com.example.test', 42);

    await cache.set(SERIAL, appInfo.packageName, appInfo);
    const result = await cache.get(SERIAL, appInfo.packageName);

    expect(result).toEqual(appInfo);
  });

  it('cache invalidation works (clearForDevice removes entries)', async () => {
    const appInfo = makeInfo('com.example.invalidate');
    await cache.set(SERIAL, appInfo.packageName, appInfo);

    await cache.clearForDevice(SERIAL);
    const result = await cache.get(SERIAL, appInfo.packageName);

    expect(result).toBeNull();
  });

  it('clear removes all entries', async () => {
    await cache.set(SERIAL, 'app1', makeInfo('app1', 1));
    await cache.set(SERIAL, 'app2', makeInfo('app2', 2));

    await cache.clearAll();

    expect(await cache.get(SERIAL, 'app1')).toBeNull();
    expect(await cache.get(SERIAL, 'app2')).toBeNull();
  });
});
