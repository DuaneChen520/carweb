import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DesktopStateStore } from '@/lib/desktop-state-store';

describe('DesktopStateStore', () => {
  let store: DesktopStateStore;

  beforeEach(async () => {
    store = new DesktopStateStore();
    // 用 clearAll 清空数据，避免 deleteDatabase 与缓存的 DB 连接冲突
    await store.clearAll();
  });

  it('不存在的设备返回 null', async () => {
    const result = await store.get('unknown-device');
    expect(result).toBeNull();
  });

  it('set 后 get 返回相同数据', async () => {
    const state = {
      deviceSerial: 'dev1',
      paneLeft: 'com.amap.amapauto',
      paneRight: null,
      savedAt: Date.now(),
    };
    await store.set(state);
    const result = await store.get('dev1');
    expect(result).toEqual(state);
  });

  it('set 覆盖同设备的旧数据', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.a',
      paneRight: 'com.b',
      savedAt: 1,
    });
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.c',
      paneRight: null,
      savedAt: 2,
    });
    const result = await store.get('dev1');
    expect(result?.paneLeft).toBe('com.c');
    expect(result?.paneRight).toBeNull();
    expect(result?.savedAt).toBe(2);
  });

  it('不同 deviceSerial 隔离', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.a',
      paneRight: null,
      savedAt: 1,
    });
    await store.set({
      deviceSerial: 'dev2',
      paneLeft: 'com.b',
      paneRight: 'com.c',
      savedAt: 2,
    });
    expect((await store.get('dev1'))?.paneLeft).toBe('com.a');
    expect((await store.get('dev2'))?.paneLeft).toBe('com.b');
    expect((await store.get('dev2'))?.paneRight).toBe('com.c');
  });

  it('clear 清除指定设备', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.a',
      paneRight: null,
      savedAt: 1,
    });
    await store.clear('dev1');
    expect(await store.get('dev1')).toBeNull();
  });

  it('clear 不影响其他设备', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.a',
      paneRight: null,
      savedAt: 1,
    });
    await store.set({
      deviceSerial: 'dev2',
      paneLeft: 'com.b',
      paneRight: null,
      savedAt: 2,
    });
    await store.clear('dev1');
    expect(await store.get('dev1')).toBeNull();
    expect((await store.get('dev2'))?.paneLeft).toBe('com.b');
  });

  it('clearAll 清除所有设备', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.a',
      paneRight: null,
      savedAt: 1,
    });
    await store.set({
      deviceSerial: 'dev2',
      paneLeft: 'com.b',
      paneRight: null,
      savedAt: 2,
    });
    await store.clearAll();
    expect(await store.get('dev1')).toBeNull();
    expect(await store.get('dev2')).toBeNull();
  });

  it('支持 paneLeft 和 paneRight 都为 null（空桌面）', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: null,
      paneRight: null,
      savedAt: 1,
    });
    const result = await store.get('dev1');
    expect(result?.paneLeft).toBeNull();
    expect(result?.paneRight).toBeNull();
  });

  it('支持 paneLeft 和 paneRight 都有值（双分屏）', async () => {
    await store.set({
      deviceSerial: 'dev1',
      paneLeft: 'com.amap.amapauto',
      paneRight: 'com.netease.cloudmusic',
      savedAt: 1,
    });
    const result = await store.get('dev1');
    expect(result?.paneLeft).toBe('com.amap.amapauto');
    expect(result?.paneRight).toBe('com.netease.cloudmusic');
  });
});
