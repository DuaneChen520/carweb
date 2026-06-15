export interface PinnedRecord {
  packageName: string;
  order: number;
}

export interface LaunchCountRecord {
  packageName: string;
  localCount: number;
  dexBaseline: number;
}

export class UserPreferencesStore {
  private dbName: string;
  private dbVersion = 1;
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
        if (!db.objectStoreNames.contains('pinned')) {
          db.createObjectStore('pinned', { keyPath: 'packageName' });
        }
        if (!db.objectStoreNames.contains('launch-counts')) {
          db.createObjectStore('launch-counts', { keyPath: 'packageName' });
        }
      };
    });
  }

  // ── Pinned ──

  async getPinned(): Promise<PinnedRecord[]> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readonly');
      const store = transaction.objectStore('pinned');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = (request.result as PinnedRecord[]).sort(
          (a, b) => a.order - b.order,
        );
        resolve(records);
      };
    });
  }

  async setPinned(records: PinnedRecord[]): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      const clearReq = store.clear();

      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        let pending = records.length;
        if (pending === 0) {
          resolve();
          return;
        }

        for (const record of records) {
          const putReq = store.put(record);
          putReq.onerror = () => reject(putReq.error);
          putReq.onsuccess = () => {
            pending -= 1;
            if (pending === 0) resolve();
          };
        }
      };
    });
  }

  async togglePinned(packageName: string): Promise<boolean> {
    const db = await this.openDB();

    const currentlyPinned = await this.isPinned(packageName);
    if (currentlyPinned) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('pinned', 'readwrite');
        const store = transaction.objectStore('pinned');
        const request = store.delete(packageName);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(false);
      });
    }

    const existing = await this.getPinned();
    const maxOrder = existing.reduce(
      (max, r) => Math.max(max, r.order),
      -1,
    );
    const newRecord: PinnedRecord = {
      packageName,
      order: maxOrder + 1,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      const request = store.put(newRecord);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async isPinned(packageName: string): Promise<boolean> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readonly');
      const store = transaction.objectStore('pinned');
      const request = store.getKey(packageName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result !== undefined);
    });
  }

  // ── Launch Counts ──

  async getLaunchCounts(): Promise<Map<string, LaunchCountRecord>> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readonly');
      const store = transaction.objectStore('launch-counts');
      const request = store.getAll();

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

  async incrementLaunchCount(packageName: string): Promise<void> {
    const db = await this.openDB();
    const map = await this.getLaunchCounts();
    const existing = map.get(packageName);

    if (existing) {
      existing.localCount += 1;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('launch-counts', 'readwrite');
        const store = transaction.objectStore('launch-counts');
        const request = store.put(existing);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }

    const newRecord: LaunchCountRecord = {
      packageName,
      localCount: 1,
      dexBaseline: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      const request = store.put(newRecord);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async bulkSetDexBaseline(
    entries: [string, number][],
  ): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      let pending = entries.length;

      if (pending === 0) {
        resolve();
        return;
      }

      for (const [packageName, baseline] of entries) {
        const getReq = store.get(packageName);
        getReq.onerror = () => reject(getReq.error);
        getReq.onsuccess = () => {
          const existing = getReq.result as
            | LaunchCountRecord
            | undefined;
          const record: LaunchCountRecord = existing ?? {
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

  async clearPinned(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pinned', 'readwrite');
      const store = transaction.objectStore('pinned');
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearLocalCounts(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('launch-counts', 'readwrite');
      const store = transaction.objectStore('launch-counts');
      const cursor = store.openCursor();

      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const result = cursor.result;
        if (result) {
          const record = result.value as LaunchCountRecord;
          record.localCount = 0;
          result.update(record);
          result.continue();
        } else {
          resolve();
        }
      };
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['pinned', 'launch-counts'],
        'readwrite',
      );
      const pinnedStore = transaction.objectStore('pinned');
      const countsStore = transaction.objectStore('launch-counts');

      let done = 0;
      const onSuccess = () => {
        done += 1;
        if (done === 2) resolve();
      };

      pinnedStore.clear().onsuccess = onSuccess;
      countsStore.clear().onsuccess = onSuccess;

      transaction.onerror = () => reject(transaction.error);
    });
  }
}
