export interface DeviceAppRecord {
  packageName: string;
  versionCode: number;
  launchCount: number;
  localCount: number;
  pinned: boolean;
  pinOrder: number;
  lastSynced: number;
}

export class DeviceAppsStore {
  private dbName = 'device-apps';
  private storeName = 'apps';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

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
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'packageName' });
        }
      };
    });
  }

  async getAll(): Promise<DeviceAppRecord[]> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as DeviceAppRecord[]);
    });
  }

  async setAll(records: DeviceAppRecord[]): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
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

  async get(packageName: string): Promise<DeviceAppRecord | null> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(packageName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  async updateLocalCount(packageName: string, localCount: number): Promise<void> {
    const db = await this.openDB();
    const existing = await this.get(packageName);

    if (existing) {
      existing.localCount = localCount;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(existing);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }

    const newRecord: DeviceAppRecord = {
      packageName,
      versionCode: 0,
      launchCount: 0,
      localCount,
      pinned: false,
      pinOrder: -1,
      lastSynced: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(newRecord);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async incrementLocalCount(packageName: string): Promise<void> {
    const db = await this.openDB();
    const existing = await this.get(packageName);

    const localCount = (existing?.localCount ?? 0) + 1;

    if (existing) {
      existing.localCount = localCount;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(existing);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }

    const newRecord: DeviceAppRecord = {
      packageName,
      versionCode: 0,
      launchCount: 0,
      localCount,
      pinned: false,
      pinOrder: -1,
      lastSynced: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(newRecord);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async togglePin(packageName: string): Promise<boolean> {
    const db = await this.openDB();
    const existing = await this.get(packageName);

    if (existing) {
      const newPinned = !existing.pinned;
      existing.pinned = newPinned;
      existing.pinOrder = newPinned ? Date.now() : -1;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(existing);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(newPinned);
      });
    }

    const newRecord: DeviceAppRecord = {
      packageName,
      versionCode: 0,
      launchCount: 0,
      localCount: 0,
      pinned: true,
      pinOrder: Date.now(),
      lastSynced: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(newRecord);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async getPinnedApps(): Promise<DeviceAppRecord[]> {
    const all = await this.getAll();
    return all
      .filter(a => a.pinned)
      .sort((a, b) => b.pinOrder - a.pinOrder);
  }

  async clear(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
