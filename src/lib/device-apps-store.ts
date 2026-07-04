export interface DeviceAppRecord {
  deviceSerial: string;
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
  private dbVersion = 2; // 版本 1 → 2
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
        if (event.oldVersion < 2) {
          if (db.objectStoreNames.contains(this.storeName)) {
            db.deleteObjectStore(this.storeName);
          }
          db.createObjectStore(this.storeName, {
            keyPath: ['deviceSerial', 'packageName']
          });
        }
      };
    });
  }

  async getAll(deviceSerial: string): Promise<DeviceAppRecord[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? []);
    });
  }

  async setAll(deviceSerial: string, records: DeviceAppRecord[]): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      for (const record of records) {
        store.put(record);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async get(deviceSerial: string, packageName: string): Promise<DeviceAppRecord | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get([deviceSerial, packageName]);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  async updateLocalCount(deviceSerial: string, packageName: string, localCount: number): Promise<void> {
    const db = await this.openDB();
    const existing = await this.get(deviceSerial, packageName);
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
      deviceSerial,
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

  async incrementLocalCount(deviceSerial: string, packageName: string): Promise<void> {
    const existing = await this.get(deviceSerial, packageName);
    const localCount = (existing?.localCount ?? 0) + 1;
    if (existing) {
      existing.localCount = localCount;
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(existing);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
    await this.updateLocalCount(deviceSerial, packageName, 1);
  }

  async togglePin(deviceSerial: string, packageName: string): Promise<boolean> {
    const existing = await this.get(deviceSerial, packageName);
    if (existing) {
      const newPinned = !existing.pinned;
      existing.pinned = newPinned;
      existing.pinOrder = newPinned ? Date.now() : -1;
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(existing);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(newPinned);
      });
    }
    const newRecord: DeviceAppRecord = {
      deviceSerial,
      packageName,
      versionCode: 0,
      launchCount: 0,
      localCount: 0,
      pinned: true,
      pinOrder: Date.now(),
      lastSynced: 0,
    };
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(newRecord);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async getPinnedApps(deviceSerial: string): Promise<DeviceAppRecord[]> {
    const all = await this.getAll(deviceSerial);
    return all
      .filter(a => a.pinned)
      .sort((a, b) => b.pinOrder - a.pinOrder);
  }

  async clearForDevice(deviceSerial: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.delete(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async allDeviceSerials(): Promise<string[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = (request.result as [string, string][]);
        const serials = [...new Set(keys.map(k => k[0]))];
        resolve(serials);
      };
    });
  }
}