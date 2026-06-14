import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppInfoCache } from './app-info-cache';

describe('AppInfoCache', () => {
  let cache: AppInfoCache;

  beforeEach(() => {
    cache = new AppInfoCache('test-app-info');
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe('tracer bullet: 缓存命中/未命中', () => {
    it('未命中时返回 null', async () => {
      const result = await cache.get('com.example.app');
      expect(result).toBeNull();
    });

    it('set 后 get 返回缓存数据', async () => {
      const info = {
        packageName: 'com.example.app',
        label: '测试应用',
        iconBase64: 'data:image/png;base64,xxx',
        versionCode: 1,
        lastParsed: Date.now(),
      };

      await cache.set('com.example.app', info);
      const result = await cache.get('com.example.app');

      expect(result).toEqual(info);
    });
  });

  describe('缓存大小', () => {
    it('getCacheSize 返回缓存大小', async () => {
      const info1 = {
        packageName: 'com.example.app1',
        label: '应用1',
        iconBase64: 'data:image/png;base64,xxx',
        versionCode: 1,
        lastParsed: Date.now(),
      };
      const info2 = {
        packageName: 'com.example.app2',
        label: '应用2',
        iconBase64: 'data:image/png;base64,yyy',
        versionCode: 2,
        lastParsed: Date.now(),
      };

      await cache.set('com.example.app1', info1);
      await cache.set('com.example.app2', info2);

      const size = await cache.getCacheSize();
      expect(size).toBeGreaterThan(0);
    });

    it('getCacheSize 在空缓存时返回 0', async () => {
      const size = await cache.getCacheSize();
      expect(size).toBe(0);
    });
  });

  describe('版本失效机制', () => {
    it('invalidate 后 get 返回 null', async () => {
      const info = {
        packageName: 'com.example.app',
        label: '测试应用',
        iconBase64: 'data:image/png;base64,xxx',
        versionCode: 1,
        lastParsed: Date.now(),
      };

      await cache.set('com.example.app', info);
      await cache.invalidate('com.example.app');
      const result = await cache.get('com.example.app');

      expect(result).toBeNull();
    });

    it('clear 后所有缓存被清空', async () => {
      const info1 = {
        packageName: 'com.example.app1',
        label: '应用1',
        iconBase64: 'data:image/png;base64,xxx',
        versionCode: 1,
        lastParsed: Date.now(),
      };
      const info2 = {
        packageName: 'com.example.app2',
        label: '应用2',
        iconBase64: 'data:image/png;base64,yyy',
        versionCode: 2,
        lastParsed: Date.now(),
      };

      await cache.set('com.example.app1', info1);
      await cache.set('com.example.app2', info2);
      await cache.clear();

      const result1 = await cache.get('com.example.app1');
      const result2 = await cache.get('com.example.app2');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });
});
