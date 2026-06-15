import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserPreferencesStore } from '../user-preferences-store';

describe('UserPreferencesStore', () => {
  let store: UserPreferencesStore;

  beforeEach(() => {
    store = new UserPreferencesStore('test-user-preferences');
  });

  afterEach(async () => {
    await store.clearAll();
  });

  describe('pinned', () => {
    it('getPinned returns empty array when no pins exist', async () => {
      const pinned = await store.getPinned();
      expect(pinned).toEqual([]);
    });

    it('isPinned returns false for non-existent key', async () => {
      const result = await store.isPinned('com.example.app');
      expect(result).toBe(false);
    });

    it('togglePinned adds a record and returns true', async () => {
      const result = await store.togglePinned('com.example.app');
      expect(result).toBe(true);
      const pinned = await store.getPinned();
      expect(pinned).toHaveLength(1);
      expect(pinned[0]).toEqual({
        packageName: 'com.example.app',
        order: 0,
      });
    });

    it('togglePinned removes an existing record and returns false', async () => {
      await store.togglePinned('com.example.app');
      const result = await store.togglePinned('com.example.app');
      expect(result).toBe(false);
      const pinned = await store.getPinned();
      expect(pinned).toEqual([]);
    });

    it('isPinned returns true after pinning', async () => {
      await store.togglePinned('com.example.app');
      const result = await store.isPinned('com.example.app');
      expect(result).toBe(true);
    });

    it('togglePinned assigns incrementing order numbers', async () => {
      await store.togglePinned('app.one');
      await store.togglePinned('app.two');
      await store.togglePinned('app.three');
      const pinned = await store.getPinned();
      expect(pinned).toHaveLength(3);
      // getPinned sorts by order descending (last pinned first)
      expect(pinned[0]).toEqual({ packageName: 'app.three', order: 2 });
      expect(pinned[1]).toEqual({ packageName: 'app.two', order: 1 });
      expect(pinned[2]).toEqual({ packageName: 'app.one', order: 0 });
    });

    it('getPinned returns records sorted by order', async () => {
      await store.togglePinned('app.third');
      await store.togglePinned('app.first');
      await store.togglePinned('app.second');
      // Manually reorder
      await store.setPinned([
        { packageName: 'app.first', order: 0 },
        { packageName: 'app.second', order: 1 },
        { packageName: 'app.third', order: 2 },
      ]);
      const pinned = await store.getPinned();
      // getPinned sorts by order descending (last pinned first)
      expect(pinned.map((r) => r.packageName)).toEqual([
        'app.third',
        'app.second',
        'app.first',
      ]);
    });

    it('setPinned batch overwrites existing pins', async () => {
      await store.togglePinned('app.one');
      await store.setPinned([
        { packageName: 'app.two', order: 0 },
        { packageName: 'app.three', order: 1 },
      ]);
      const pinned = await store.getPinned();
      expect(pinned).toHaveLength(2);
      // getPinned sorts by order descending (last pinned first)
      expect(pinned[0].packageName).toBe('app.three');
      expect(pinned[1].packageName).toBe('app.two');
    });

    it('setPinned with empty array clears pins', async () => {
      await store.togglePinned('app.one');
      await store.setPinned([]);
      const pinned = await store.getPinned();
      expect(pinned).toEqual([]);
    });

    it('clearPinned removes all pins', async () => {
      await store.togglePinned('app.one');
      await store.togglePinned('app.two');
      await store.clearPinned();
      const pinned = await store.getPinned();
      expect(pinned).toEqual([]);
    });

    it('re-pinning after removal reuses the next order number', async () => {
      await store.togglePinned('app.one');
      await store.togglePinned('app.one');
      const result = await store.togglePinned('app.one');
      expect(result).toBe(true);
      const pinned = await store.getPinned();
      expect(pinned).toHaveLength(1);
      expect(pinned[0].order).toBe(0);
    });
  });

  describe('launch counts', () => {
    it('getLaunchCounts returns empty map when no records exist', async () => {
      const counts = await store.getLaunchCounts();
      expect(counts.size).toBe(0);
    });

    it('incrementLaunchCount creates a new record with count 1', async () => {
      await store.incrementLaunchCount('com.example.app');
      const counts = await store.getLaunchCounts();
      const record = counts.get('com.example.app');
      expect(record).toBeDefined();
      expect(record!.localCount).toBe(1);
      expect(record!.dexBaseline).toBe(0);
    });

    it('incrementLaunchCount increments existing count', async () => {
      await store.incrementLaunchCount('com.example.app');
      await store.incrementLaunchCount('com.example.app');
      await store.incrementLaunchCount('com.example.app');
      const counts = await store.getLaunchCounts();
      expect(counts.get('com.example.app')!.localCount).toBe(3);
    });

    it('incrementLaunchCount preserves dexBaseline', async () => {
      await store.bulkSetDexBaseline([['com.example.app', 5]]);
      await store.incrementLaunchCount('com.example.app');
      const counts = await store.getLaunchCounts();
      expect(counts.get('com.example.app')!.localCount).toBe(1);
      expect(counts.get('com.example.app')!.dexBaseline).toBe(5);
    });

    it('bulkSetDexBaseline sets baseline for new records', async () => {
      await store.bulkSetDexBaseline([['com.example.app', 10]]);
      const counts = await store.getLaunchCounts();
      const record = counts.get('com.example.app');
      expect(record).toBeDefined();
      expect(record!.localCount).toBe(0);
      expect(record!.dexBaseline).toBe(10);
    });

    it('bulkSetDexBaseline does not overwrite localCount', async () => {
      await store.incrementLaunchCount('com.example.app');
      await store.incrementLaunchCount('com.example.app');
      await store.bulkSetDexBaseline([['com.example.app', 99]]);
      const counts = await store.getLaunchCounts();
      expect(counts.get('com.example.app')!.localCount).toBe(2);
      expect(counts.get('com.example.app')!.dexBaseline).toBe(99);
    });

    it('bulkSetDexBaseline handles multiple entries', async () => {
      await store.incrementLaunchCount('app.one');
      await store.bulkSetDexBaseline([
        ['app.one', 5],
        ['app.two', 10],
        ['app.three', 15],
      ]);
      const counts = await store.getLaunchCounts();
      expect(counts.get('app.one')!.localCount).toBe(1);
      expect(counts.get('app.one')!.dexBaseline).toBe(5);
      expect(counts.get('app.two')!.localCount).toBe(0);
      expect(counts.get('app.two')!.dexBaseline).toBe(10);
      expect(counts.get('app.three')!.localCount).toBe(0);
      expect(counts.get('app.three')!.dexBaseline).toBe(15);
    });

    it('bulkSetDexBaseline with empty array does nothing', async () => {
      await store.incrementLaunchCount('app.one');
      await store.bulkSetDexBaseline([]);
      const counts = await store.getLaunchCounts();
      expect(counts.size).toBe(1);
    });
  });

  describe('clear methods', () => {
    it('clearLocalCounts resets localCount to 0 but preserves dexBaseline', async () => {
      await store.incrementLaunchCount('app.one');
      await store.incrementLaunchCount('app.one');
      await store.incrementLaunchCount('app.two');
      await store.bulkSetDexBaseline([
        ['app.one', 100],
        ['app.two', 200],
      ]);
      await store.clearLocalCounts();
      const counts = await store.getLaunchCounts();
      expect(counts.get('app.one')!.localCount).toBe(0);
      expect(counts.get('app.one')!.dexBaseline).toBe(100);
      expect(counts.get('app.two')!.localCount).toBe(0);
      expect(counts.get('app.two')!.dexBaseline).toBe(200);
    });

    it('clearLocalCounts on non-existent records does nothing', async () => {
      await store.clearLocalCounts();
      const counts = await store.getLaunchCounts();
      expect(counts.size).toBe(0);
    });

    it('clearAll clears both stores', async () => {
      await store.togglePinned('app.pinned');
      await store.incrementLaunchCount('app.launched');
      await store.clearAll();
      const pinned = await store.getPinned();
      const counts = await store.getLaunchCounts();
      expect(pinned).toEqual([]);
      expect(counts.size).toBe(0);
    });
  });

  describe('independent stores', () => {
    it('pinned and launch-counts operations do not interfere', async () => {
      await store.togglePinned('com.example.app');
      await store.incrementLaunchCount('com.example.app');
      const pinned = await store.getPinned();
      const counts = await store.getLaunchCounts();
      expect(pinned).toHaveLength(1);
      expect(counts.size).toBe(1);
      await store.clearPinned();
      const pinnedAfter = await store.getPinned();
      const countsAfter = await store.getLaunchCounts();
      expect(pinnedAfter).toEqual([]);
      expect(countsAfter.size).toBe(1);
    });
  });
});
