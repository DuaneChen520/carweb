export interface PinnedRecord {
  deviceSerial: string;
  packageName: string;
  order: number;
}

export interface LaunchCountRecord {
  deviceSerial: string;
  packageName: string;
  localCount: number;
  dexBaseline: number;
}

export class UserPreferencesStore {
  private dbName: string;
  private dbVersion = 2; // 版本 1 → 2
  private db: IDBDatabase | null = null;

  constructor(dbName: string = 'user-preferences') {
    this.dbName = dbName;
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (event.oldVersion < 2) {
          // 重建 pinned store
          if (db.objectStoreNames.contains('pinned')) {
            db.deleteObjectStore('pinned');
          }
          db.createObjectStore('pinned', {
            keyPath: ['deviceSerial', 'packageName']
          });
          // 重建 launch-counts store
          if (db.objectStoreNames.contains('launch-counts')) {
            db.deleteObjectStore('launch-counts');
          }
          db.createObjectStore('launch-counts', {
            keyPath: ['deviceSerial', 'packageName']
          });
        }
      };
    });
  }

  // ── Pinned ──

  async getPinned(deviceSerial: string): Promise<PinnedRecord[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readonly');
      const store = transaction.objectStore('pinned');
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = (request.result as PinnedRecord[]).sort(
          (a, b) => b.order - a.order,
        );
        resolve(records);
      };
    });
  }

  async setPinned(deviceSerial: string, records: PinnedRecord[]): Promise<void> {
    const db = await this.openDB();
    // 先清空该设备的固定记录，再批量写入
    await this.clearPinned(deviceSerial);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      let pending = records.length;
      if (pending === 0) { resolve(); return; }
      for (const record of records) {
        const putReq = store.put({ ...record, deviceSerial });
        putReq.onerror = () => reject(putReq.error);
        putReq.onsuccess = () => {
          pending -= 1;
          if (pending === 0) resolve();
        };
      }
    });
  }

  async togglePinned(deviceSerial: string, packageName: string): Promise<boolean> {
    const currentlyPinned = await this.isPinned(deviceSerial, packageName);
    if (currentlyPinned) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('pinned', 'readwrite');
        const store = transaction.objectStore('pinned');
        const request = store.delete([deviceSerial, packageName]);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(false);
      });
    }
    const existing = await this.getPinned(deviceSerial);
    const maxOrder = existing.reduce((max, r) => Math.max(max, r.order), -1);
    const newRecord: PinnedRecord = {
      deviceSerial,
      packageName,
      order: maxOrder + 1,
    };
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      const request = store.put(newRecord);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async isPinned(deviceSerial: string, packageName: string): Promise<boolean> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readonly');
      const store = transaction.objectStore('pinned');
      const request = store.getKey([deviceSerial, packageName]);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result !== undefined);
    });
  }

  // ── Launch Counts ──

  async getLaunchCounts(deviceSerial: string): Promise<Map<string, LaunchCountRecord>> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readonly');
      const store = transaction.objectStore('launch-counts');
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = request.result as LaunchCountRecord[];
        const map = new Map<string, LaunchCountRecord>();
        for (const record of records) {
          map.set(record.packageName, record);
        }
        resolve(map);
      };
    });
  }

  async incrementLaunchCount(deviceSerial: string, packageName: string): Promise<void> {
    const map = await this.getLaunchCounts(deviceSerial);
    const existing = map.get(packageName);
    if (existing) {
      existing.localCount += 1;
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('launch-counts', 'readwrite');
        const store = transaction.objectStore('launch-counts');
        const request = store.put(existing);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
    const newRecord: LaunchCountRecord = {
      deviceSerial,
      packageName,
      localCount: 1,
      dexBaseline: 0,
    };
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      const request = store.put(newRecord);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async bulkSetDexBaseline(deviceSerial: string, entries: [string, number][]): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      let pending = entries.length;
      if (pending === 0) { resolve(); return; }
      for (const [packageName, baseline] of entries) {
        const getReq = store.get([deviceSerial, packageName]);
        getReq.onerror = () => reject(getReq.error);
        getReq.onsuccess = () => {
          const existing = getReq.result as LaunchCountRecord | undefined;
          const record: LaunchCountRecord = existing ?? {
            deviceSerial,
            packageName,
            localCount: 0,
            dexBaseline: 0,
          };
          record.dexBaseline = baseline;
          const putReq = store.put(record);
          putReq.onerror = () => reject(putReq.error);
          putReq.onsuccess = () => {
            pending -= 1;
            if (pending === 0) resolve();
          };
        };
      }
    });
  }

  // ── Clear Methods ──

  async clearPinned(deviceSerial: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.delete(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearLocalCounts(deviceSerial: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.delete(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearAll(deviceSerial: string): Promise<void> {
    await Promise.all([
      this.clearPinned(deviceSerial),
      this.clearLocalCounts(deviceSerial),
    ]);
  }

  async clearAllDevices(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pinned', 'launch-counts'], 'readwrite');
      let done = 0;
      const onSuccess = () => {
        done += 1;
        if (done === 2) resolve();
      };
      transaction.objectStore('pinned').clear().onsuccess = onSuccess;
      transaction.objectStore('launch-counts').clear().onsuccess = onSuccess;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async allDeviceSerials(): Promise<string[]> {
    const db = await this.openDB();
    const pinnedSerials = await new Promise<string[]>((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readonly');
      const store = transaction.objectStore('pinned');
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = (request.result as [string, string][]);
        resolve([...new Set(keys.map(k => k[0]))]);
      };
    });
    const countsSerials = await new Promise<string[]>((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readonly');
      const store = transaction.objectStore('launch-counts');
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = (request.result as [string, string][]);
        resolve([...new Set(keys.map(k => k[0]))]);
      };
    });
    return [...new Set([...pinnedSerials, ...countsSerials])];
  }
}