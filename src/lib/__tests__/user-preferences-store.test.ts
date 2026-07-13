import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserPreferencesStore } from '../user-preferences-store';

const SERIAL = 'test-serial';

describe('UserPreferencesStore', () => {
  let store: UserPreferencesStore;

  beforeEach(() => {
    store = new UserPreferencesStore('test-user-preferences');
  });

  afterEach(async () => {
    await store.clearAll(SERIAL);
  });

  describe('pinned', () => {
    it('getPinned returns empty array when no pins exist', async () => {
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toEqual([]);
    });

    it('isPinned returns false for non-existent key', async () => {
      const result = await store.isPinned(SERIAL, 'com.example.app');
      expect(result).toBe(false);
    });

    it('togglePinned adds a record and returns true', async () => {
      const result = await store.togglePinned(SERIAL, 'com.example.app');
      expect(result).toBe(true);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toHaveLength(1);
      expect(pinned[0]).toEqual({
        deviceSerial: SERIAL,
        packageName: 'com.example.app',
        order: 0,
      });
    });

    it('togglePinned removes an existing record and returns false', async () => {
      await store.togglePinned(SERIAL, 'com.example.app');
      const result = await store.togglePinned(SERIAL, 'com.example.app');
      expect(result).toBe(false);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toEqual([]);
    });

    it('isPinned returns true after pinning', async () => {
      await store.togglePinned(SERIAL, 'com.example.app');
      const result = await store.isPinned(SERIAL, 'com.example.app');
      expect(result).toBe(true);
    });

    it('togglePinned assigns incrementing order numbers', async () => {
      await store.togglePinned(SERIAL, 'app.one');
      await store.togglePinned(SERIAL, 'app.two');
      await store.togglePinned(SERIAL, 'app.three');
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toHaveLength(3);
      // getPinned sorts by order descending (last pinned first)
      expect(pinned[0]).toEqual({ deviceSerial: SERIAL, packageName: 'app.three', order: 2 });
      expect(pinned[1]).toEqual({ deviceSerial: SERIAL, packageName: 'app.two', order: 1 });
      expect(pinned[2]).toEqual({ deviceSerial: SERIAL, packageName: 'app.one', order: 0 });
    });

    it('getPinned returns records sorted by order', async () => {
      await store.togglePinned(SERIAL, 'app.third');
      await store.togglePinned(SERIAL, 'app.first');
      await store.togglePinned(SERIAL, 'app.second');
      // Manually reorder
      await store.setPinned(SERIAL, [
        { deviceSerial: SERIAL, packageName: 'app.first', order: 0 },
        { deviceSerial: SERIAL, packageName: 'app.second', order: 1 },
        { deviceSerial: SERIAL, packageName: 'app.third', order: 2 },
      ]);
      const pinned = await store.getPinned(SERIAL);
      // getPinned sorts by order descending (last pinned first)
      expect(pinned.map((r) => r.packageName)).toEqual([
        'app.third',
        'app.second',
        'app.first',
      ]);
    });

    it('setPinned batch overwrites existing pins', async () => {
      await store.togglePinned(SERIAL, 'app.one');
      await store.setPinned(SERIAL, [
        { deviceSerial: SERIAL, packageName: 'app.two', order: 0 },
        { deviceSerial: SERIAL, packageName: 'app.three', order: 1 },
      ]);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toHaveLength(2);
      // getPinned sorts by order descending (last pinned first)
      expect(pinned[0].packageName).toBe('app.three');
      expect(pinned[1].packageName).toBe('app.two');
    });

    it('setPinned with empty array clears pins', async () => {
      await store.togglePinned(SERIAL, 'app.one');
      await store.setPinned(SERIAL, []);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toEqual([]);
    });

    it('clearPinned removes all pins', async () => {
      await store.togglePinned(SERIAL, 'app.one');
      await store.togglePinned(SERIAL, 'app.two');
      await store.clearPinned(SERIAL);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toEqual([]);
    });

    it('re-pinning after removal reuses the next order number', async () => {
      await store.togglePinned(SERIAL, 'app.one');
      await store.togglePinned(SERIAL, 'app.one');
      const result = await store.togglePinned(SERIAL, 'app.one');
      expect(result).toBe(true);
      const pinned = await store.getPinned(SERIAL);
      expect(pinned).toHaveLength(1);
      expect(pinned[0].order).toBe(0);
    });
  });

  describe('launch counts', () => {
    it('getLaunchCounts returns empty map when no records exist', async () => {
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.size).toBe(0);
    });

    it('incrementLaunchCount creates a new record with count 1', async () => {
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      const counts = await store.getLaunchCounts(SERIAL);
      const record = counts.get('com.example.app');
      expect(record).toBeDefined();
      expect(record!.localCount).toBe(1);
      expect(record!.dexBaseline).toBe(0);
    });

    it('incrementLaunchCount increments existing count', async () => {
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.get('com.example.app')!.localCount).toBe(3);
    });

    it('incrementLaunchCount preserves dexBaseline', async () => {
      await store.bulkSetDexBaseline(SERIAL, [['com.example.app', 5]]);
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.get('com.example.app')!.localCount).toBe(1);
      expect(counts.get('com.example.app')!.dexBaseline).toBe(5);
    });

    it('bulkSetDexBaseline sets baseline for new records', async () => {
      await store.bulkSetDexBaseline(SERIAL, [['com.example.app', 10]]);
      const counts = await store.getLaunchCounts(SERIAL);
      const record = counts.get('com.example.app');
      expect(record).toBeDefined();
      expect(record!.localCount).toBe(0);
      expect(record!.dexBaseline).toBe(10);
    });

    it('bulkSetDexBaseline does not overwrite localCount', async () => {
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      await store.bulkSetDexBaseline(SERIAL, [['com.example.app', 99]]);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.get('com.example.app')!.localCount).toBe(2);
      expect(counts.get('com.example.app')!.dexBaseline).toBe(99);
    });

    it('bulkSetDexBaseline handles multiple entries', async () => {
      await store.incrementLaunchCount(SERIAL, 'app.one');
      await store.bulkSetDexBaseline(SERIAL, [
        ['app.one', 5],
        ['app.two', 10],
        ['app.three', 15],
      ]);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.get('app.one')!.localCount).toBe(1);
      expect(counts.get('app.one')!.dexBaseline).toBe(5);
      expect(counts.get('app.two')!.localCount).toBe(0);
      expect(counts.get('app.two')!.dexBaseline).toBe(10);
      expect(counts.get('app.three')!.localCount).toBe(0);
      expect(counts.get('app.three')!.dexBaseline).toBe(15);
    });

    it('bulkSetDexBaseline with empty array does nothing', async () => {
      await store.incrementLaunchCount(SERIAL, 'app.one');
      await store.bulkSetDexBaseline(SERIAL, []);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.size).toBe(1);
    });
  });

  describe('clear methods', () => {
    it('clearLocalCounts removes all launch-count records for the device', async () => {
      await store.incrementLaunchCount(SERIAL, 'app.one');
      await store.incrementLaunchCount(SERIAL, 'app.two');
      await store.bulkSetDexBaseline(SERIAL, [
        ['app.one', 100],
        ['app.two', 200],
      ]);
      await store.clearLocalCounts(SERIAL);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.size).toBe(0);
    });

    it('clearLocalCounts on non-existent records does nothing', async () => {
      await store.clearLocalCounts(SERIAL);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(counts.size).toBe(0);
    });

    it('clearAll clears both stores', async () => {
      await store.togglePinned(SERIAL, 'app.pinned');
      await store.incrementLaunchCount(SERIAL, 'app.launched');
      await store.clearAll(SERIAL);
      const pinned = await store.getPinned(SERIAL);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(pinned).toEqual([]);
      expect(counts.size).toBe(0);
    });
  });

  describe('independent stores', () => {
    it('pinned and launch-counts operations do not interfere', async () => {
      await store.togglePinned(SERIAL, 'com.example.app');
      await store.incrementLaunchCount(SERIAL, 'com.example.app');
      const pinned = await store.getPinned(SERIAL);
      const counts = await store.getLaunchCounts(SERIAL);
      expect(pinned).toHaveLength(1);
      expect(counts.size).toBe(1);
      await store.clearPinned(SERIAL);
      const pinnedAfter = await store.getPinned(SERIAL);
      const countsAfter = await store.getLaunchCounts(SERIAL);
      expect(pinnedAfter).toEqual([]);
      expect(countsAfter.size).toBe(1);
    });
  });
});
