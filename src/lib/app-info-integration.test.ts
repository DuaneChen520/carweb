import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppInfoCache } from './app-info-cache';

describe('AppInfo Integration', () => {
  let cache: AppInfoCache;

  beforeEach(() => {
    cache = new AppInfoCache('integration-test');
  });

  afterEach(async () => {
    await cache.clear();
  });

  it('cache stores and retrieves app info correctly', async () => {
    const appInfo = {
      packageName: 'com.example.test',
      label: 'Test App',
      iconBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      versionCode: 42,
      lastParsed: Date.now(),
    };

    await cache.set(appInfo.packageName, appInfo);
    const result = await cache.get(appInfo.packageName);

    expect(result).toEqual(appInfo);
  });

  it('cache invalidation works', async () => {
    const appInfo = {
      packageName: 'com.example.invalidate',
      label: 'To Invalidate',
      iconBase64: null,
      versionCode: 1,
      lastParsed: Date.now(),
    };

    await cache.set(appInfo.packageName, appInfo);
    await cache.invalidate(appInfo.packageName);
    const result = await cache.get(appInfo.packageName);

    expect(result).toBeNull();
  });

  it('clear removes all entries', async () => {
    await cache.set('app1', { packageName: 'app1', label: 'App 1', iconBase64: null, versionCode: 1, lastParsed: Date.now() });
    await cache.set('app2', { packageName: 'app2', label: 'App 2', iconBase64: null, versionCode: 2, lastParsed: Date.now() });

    await cache.clear();

    expect(await cache.get('app1')).toBeNull();
    expect(await cache.get('app2')).toBeNull();
  });
});
